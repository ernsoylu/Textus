import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { FIRST_RECORD_TYPE, WORK_TYPES, WORK_TYPE_LABELS, type WorkType } from '@/lib/recordTypes';
import { MAX_UPLOAD_BYTES, uploadFile } from '@/hooks/useUploadAsset';
import { importMetadata } from '@/lib/autoMetadataImport';


// FR-CAT-1/2: creates a work and its first record. The optional author field creates
// one contributor; the record page supports structured credits and metadata matching.
async function createWork(userId: string, title: string, workType: string, authorName: string, fromUpload = false) {
  const { data: work, error: workError } = await supabase
    .from('works')
    .insert({ user_id: userId, title, work_type: workType, metadata: { locked_fields: fromUpload ? [] : ['title', 'work_type'] } } as never)
    .select('id')
    .single();
  if (workError) throw workError;

  const recordType = FIRST_RECORD_TYPE[workType as WorkType];
  if (!recordType) return work.id;

  const { data: record, error: recordError } = await supabase
    .from('records')
    .insert({ work_id: work.id, record_type: recordType, metadata: authorName.trim() ? { locked_fields: ['contributors'] } : {} })
    .select('id')
    .single();
  if (recordError) {
    await supabase.from('works').delete().eq('id', work.id);
    throw recordError;
  }

  const trimmed = authorName.trim();
  if (trimmed) {
    const familyName = trimmed.split(/\s+/).at(-1)!;
    // ponytail: naive match_key (lowercased family name only); shared/names.ts fold() covers
    // particles/diacritics properly once the contributor-matching slice is built.
    const { data: contributor, error: contributorError } = await supabase
      .from('contributors')
      .insert({
        user_id: userId,
        display_name: trimmed,
        family_name: familyName,
        sort_name: trimmed,
        match_key: familyName.toLowerCase(),
      })
      .select('id')
      .single();
    if (contributorError) throw contributorError;

    const { error: creditError } = await supabase
      .from('record_contributors')
      .insert({ record_id: record.id, contributor_id: contributor.id, role: 'author', position: 0, resolved_by: 'new' });
    if (creditError) throw creditError;
  }

  return work.id;
}

interface UploadItem {
  file: File;
  workId?: string;
  recordId?: string;
  progress: number;
  status: 'queued' | 'uploading' | 'processing' | 'done' | 'failed';
  message?: string;
  error?: string;
}

export function NewWork() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [workType, setWorkType] = useState<(typeof WORK_TYPES)[number]>('book');
  const [author, setAuthor] = useState('');
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'upload' | 'manual'>('upload');
  const fileRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: () => createWork(session!.user.id, title.trim(), workType, author),
    onSuccess: (workId) => {
      queryClient.invalidateQueries({ queryKey: ['works'] });
      navigate(`/library/${workId}`);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (title.trim()) mutation.mutate();
  }

  const patchUpload = (index: number, change: Partial<UploadItem>) => setUploads((items) => items.map((item, i) => i === index ? { ...item, ...change } : item));
  const totalBytes = uploads.reduce((total, item) => total + item.file.size, 0);
  const uploadedBytes = uploads.reduce((total, item) => total + item.file.size * item.progress, 0);
  const totalPercent = totalBytes ? Math.round(uploadedBytes / totalBytes * 100) : 0;

  async function uploadAndAdd() {
    if (!session || !uploads.length || busy) return;
    setBusy(true);
    const processing: Promise<void>[] = [];
    const workIds: string[] = [];
    let failed = false;
    for (const [index, item] of uploads.entries()) {
      if (item.status === 'done') { workIds.push(item.workId!); continue; }
      const titleFromFile = item.file.name.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').trim() || item.file.name;
      try {
        if (!item.file.size || item.file.size > MAX_UPLOAD_BYTES) throw new Error('Choose a nonempty file up to 500 MB.');
        patchUpload(index, { status: 'uploading', progress: 0, error: undefined, message: 'Preparing upload…' });
        const workId = item.workId ?? await createWork(session.user.id, titleFromFile, 'book', '', true);
        patchUpload(index, { workId });
        const { data: work, error } = await supabase.from('works').select('records(id)').eq('id', workId).single();
        if (error) throw error;
        const recordId = (work.records as { id: string }[])[0].id;
        patchUpload(index, { recordId, message: `Uploading file ${index + 1} of ${uploads.length}` });
        await uploadFile(recordId, 'primary', item.file, (progress) => patchUpload(index, { progress }));
        workIds.push(workId);
        if (uploads.length === 1) {
          await queryClient.invalidateQueries({ queryKey: ['works'] });
          setBusy(false);
          navigate(`/library/${workId}?autofill=1`);
          return;
        }
        patchUpload(index, { status: 'processing', progress: 1, message: 'Looking up metadata…' });
        processing.push(importMetadata(
          { id: workId, title: titleFromFile, metadata: { locked_fields: [] } },
          { id: recordId, title: null, metadata: {}, metadata_fetched_at: null, publisher: null, publication_date: null, record_contributors: [], record_assets: [] },
          (message) => patchUpload(index, { message }),
        ).then(() => patchUpload(index, { status: 'done' })));
      } catch (cause) {
        failed = true;
        patchUpload(index, { status: 'failed', message: undefined, error: cause instanceof Error ? cause.message : 'Upload failed.' });
      }
    }
    await Promise.all(processing);
    await queryClient.invalidateQueries({ queryKey: ['works'] });
    setBusy(false);
    if (!failed) navigate(workIds.length === 1 ? `/library/${workIds[0]}` : '/library?sort=added');
  }

  return (
    <div className="flex max-w-[520px] flex-col gap-4">
      {mode === 'upload' ? <>
        <p className="text-heading text-fg">Add to your library</p>
        <p className="text-body text-muted">Upload a book or paper. Textus will look for an ISBN or DOI, fetch matching details and a cover, and add what it finds.</p>
        <input ref={fileRef} type="file" multiple accept=".pdf,.epub,.mobi,.azw3,.cbz" hidden disabled={busy} onChange={(e) => setUploads(Array.from(e.target.files ?? []).map((file) => ({ file, status: 'queued', progress: 0 })))} />
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-8 border border-dashed border-muted bg-dim p-6 text-fg">
          <span className="text-label">Choose files</span><span className="text-small text-muted">PDF, EPUB, MOBI, AZW3 or CBZ</span>
        </button>
        {uploads.length > 0 && <ul className="flex flex-col gap-4">
          {uploads.map((item, index) => <li key={`${item.file.name}:${index}`} className="flex flex-col gap-1 text-small text-fg">
            <p className="break-words">{item.file.name}</p>
            <progress aria-label={`Uploading ${item.file.name}`} value={item.progress} max={1} className="h-3 w-full accent-green" />
            <p className="text-muted">{Math.round(item.progress * 100)}% · {(item.file.size * item.progress / 1_048_576).toFixed(1)} / {(item.file.size / 1_048_576).toFixed(1)} MB</p>
            {item.message && <p role="status" className="text-muted">{item.message}</p>}
            {item.error && <p role="alert" className="text-red">{item.error}</p>}
            {item.workId && <Link to={`/library/${item.workId}`} className={`text-green underline ${busy ? 'pointer-events-none' : ''}`} aria-disabled={busy}>Open this work</Link>}
          </li>)}
        </ul>}
        {uploads.length > 1 && <div className="flex flex-col gap-1 text-small text-muted">
          <p>Total upload: {totalPercent}%</p>
          <progress aria-label="Total upload" value={uploadedBytes} max={totalBytes || 1} className="h-3 w-full accent-green" />
        </div>}
        <Button onClick={uploadAndAdd} isLoading={busy} disabled={!uploads.length || busy || uploads.every((item) => item.status === 'done')}>{uploads.some((item) => item.status === 'failed') ? 'Retry failed uploads' : 'Upload and add to library'}</Button>
        <button type="button" className="self-start text-small text-green underline" disabled={busy} onClick={() => setMode('manual')}>Add manually</button>
      </> : <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="text-heading text-fg">Add a work manually</p>
        <label className="flex flex-col gap-2 text-small text-fg">Type
        <select className="rounded-8 border border-muted bg-dim p-4 text-body text-fg" value={workType} onChange={(e) => setWorkType(e.target.value as (typeof WORK_TYPES)[number])}>
          {WORK_TYPES.map((t) => <option key={t} value={t}>{WORK_TYPE_LABELS[t]}</option>)}
        </select>
        </label>
        <label className="flex flex-col gap-2 text-small text-fg">Title<Input required placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        {workType !== 'serial' && <label className="flex flex-col gap-2 text-small text-fg">Author (optional)<Input placeholder="Author (optional)" value={author} onChange={(e) => setAuthor(e.target.value)} /></label>}
        {mutation.isError && <p className="text-small text-red">{mutation.error.message}</p>}
        <Button type="submit" isLoading={mutation.isPending} disabled={!title.trim()}>{mutation.isPending ? 'Adding…' : 'Add to library'}</Button>
        <button type="button" className="self-start text-small text-green underline" onClick={() => setMode('upload')}>Upload files instead</button>
      </form>}
    </div>
  );
}
