import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { FIRST_RECORD_TYPE, WORK_TYPES, WORK_TYPE_LABELS, type WorkType } from '@/lib/recordTypes';
import { MAX_UPLOAD_BYTES, uploadFile, uploadUrl } from '@/hooks/useUploadAsset';
import { importMetadata } from '@/lib/autoMetadataImport';
import { DUPLICATE_REASON_LABELS, findDuplicateWorks, sha256Hex, workWithFile } from '@/lib/duplicates';


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
  name: string;
  file?: File;
  url?: string;
  workId?: string;
  recordId?: string;
  progress: number;
  status: 'queued' | 'uploading' | 'processing' | 'done' | 'duplicate' | 'failed';
  message?: string;
  error?: string;
  similar?: { work_id: string; title: string; reason: string }[];
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
  const [link, setLink] = useState('');
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
  const totalBytes = uploads.reduce((total, item) => total + (item.file?.size ?? 0), 0);
  const uploadedBytes = uploads.reduce((total, item) => total + (item.file?.size ?? 0) * item.progress, 0);

  function addLink(e: FormEvent) {
    e.preventDefault();
    const url = new URL(link.trim());
    let name = url.pathname.split('/').filter(Boolean).at(-1) ?? '';
    try { name = decodeURIComponent(name); } catch { /* malformed escape: keep it encoded */ }
    name ||= url.hostname;
    setUploads((items) => [...items, { name, url: url.href, status: 'queued', progress: 0 }]);
    setLink('');
  }
  const totalPercent = totalBytes ? Math.round(uploadedBytes / totalBytes * 100) : 0;

  async function uploadAndAdd() {
    if (!session || !uploads.length || busy) return;
    setBusy(true);
    const processing: Promise<void>[] = [];
    const workIds: string[] = [];
    let failed = false;
    let duplicates = false;
    const markDuplicate = (index: number, workId: string) => {
      duplicates = true;
      patchUpload(index, { status: 'duplicate', workId, progress: 1, message: 'This file is already in your library.' });
    };
    for (const [index, item] of uploads.entries()) {
      if (item.status === 'duplicate') continue;
      if (item.status === 'done') { workIds.push(item.workId!); continue; }
      const titleFromFile = item.name.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ').trim() || item.name;
      try {
        if (item.file && (!item.file.size || item.file.size > MAX_UPLOAD_BYTES)) throw new Error('Choose a nonempty file up to 500 MB.');
        patchUpload(index, { status: 'uploading', progress: 0, error: undefined, message: 'Preparing upload…' });
        if (item.file && !item.workId) {
          const existing = await workWithFile(await sha256Hex(item.file));
          if (existing) { markDuplicate(index, existing); continue; }
        }
        const workId = item.workId ?? await createWork(session.user.id, titleFromFile, 'book', '', true);
        patchUpload(index, { workId });
        const { data: work, error } = await supabase.from('works').select('records(id)').eq('id', workId).single();
        if (error) throw error;
        const recordId = (work.records as { id: string }[])[0].id;
        patchUpload(index, { recordId, message: `${item.file ? 'Uploading file' : 'Downloading link'} ${index + 1} of ${uploads.length}` });
        const result = item.file ? await uploadFile(recordId, 'primary', item.file, (progress) => patchUpload(index, { progress })) : await uploadUrl(recordId, 'primary', item.url!);
        // Links can't be hashed before download, and a file can race another upload: the server's checksum settles it.
        const existing = result.status === 'deduplicated' ? await workWithFile(result.asset.checksum_sha256, workId) : undefined;
        if (existing) {
          const { error: deleteError } = await supabase.from('works').delete().eq('id', workId);
          if (deleteError) throw deleteError;
          markDuplicate(index, existing);
          continue;
        }
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
        ).then(() => findDuplicateWorks(workId).catch(() => [])).then((similar) => {
          if (similar.length) duplicates = true;
          patchUpload(index, { status: 'done', similar });
        }));
      } catch (cause) {
        failed = true;
        patchUpload(index, { status: 'failed', message: undefined, error: cause instanceof Error ? cause.message : 'Upload failed.' });
      }
    }
    await Promise.all(processing);
    await queryClient.invalidateQueries({ queryKey: ['works'] });
    setBusy(false);
    // Stay on this page when something needs a look: a failure or a possible duplicate.
    if (!failed && !duplicates) navigate(workIds.length === 1 ? `/library/${workIds[0]}` : '/library?sort=added');
  }

  return (
    <div className="flex max-w-[520px] flex-col gap-4">
      {mode === 'upload' ? <>
        <p className="text-heading text-fg">Add to your library</p>
        <p className="text-body text-muted">Upload a book or paper, or paste a link to one. Textus will look for an ISBN or DOI, fetch matching details and a cover, and add what it finds.</p>
        <input ref={fileRef} type="file" multiple accept=".pdf,.epub,.mobi,.azw3,.cbz,.djvu,.djv" hidden disabled={busy} onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          setUploads((items) => [...items.filter((item) => item.url), ...files.map((file): UploadItem => ({ name: file.name, file, status: 'queued', progress: 0 }))]);
        }} />
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-8 border border-dashed border-muted bg-dim p-6 text-fg">
          <span className="text-label">Choose files</span><span className="text-small text-muted">PDF, EPUB, MOBI, AZW3, CBZ or DjVu</span>
        </button>
        <form onSubmit={addLink} className="flex gap-2">
          <Input type="url" required aria-label="Link to a file" placeholder="https://… link to a PDF or EPUB" value={link} disabled={busy} onChange={(e) => setLink(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={busy || !link.trim()}>Add link</Button>
        </form>
        {uploads.length > 0 && <ul className="flex flex-col gap-4">
          {uploads.map((item, index) => <li key={`${item.name}:${index}`} className="flex flex-col gap-1 text-small text-fg">
            <p className="break-words">{item.name}</p>
            {/* A link has no client-side progress; an indeterminate bar shows while the server downloads it. */}
            <progress aria-label={`Uploading ${item.name}`} value={item.url && item.status === 'uploading' ? undefined : item.progress} max={1} className="h-3 w-full accent-green" />
            {item.file ? <p className="text-muted">{Math.round(item.progress * 100)}% · {(item.file.size * item.progress / 1_048_576).toFixed(1)} / {(item.file.size / 1_048_576).toFixed(1)} MB</p> : <p className="break-all text-muted">{item.url}</p>}
            {item.message && <p role="status" className="text-muted">{item.message}</p>}
            {item.error && <p role="alert" className="text-red">{item.error}</p>}
            {item.similar?.map((other) => <p key={other.work_id} role="status" className="text-yellow">Possibly already in your library: <Link to={`/library/${other.work_id}`} className="underline">{other.title}</Link> ({DUPLICATE_REASON_LABELS[other.reason] ?? other.reason})</p>)}
            {item.workId && <Link to={`/library/${item.workId}`} className={`text-green underline ${busy ? 'pointer-events-none' : ''}`} aria-disabled={busy}>View details</Link>}
          </li>)}
        </ul>}
        {uploads.length > 1 && <div className="flex flex-col gap-1 text-small text-muted">
          <p>Total upload: {totalPercent}%</p>
          <progress aria-label="Total upload" value={uploadedBytes} max={totalBytes || 1} className="h-3 w-full accent-green" />
        </div>}
        <Button onClick={uploadAndAdd} isLoading={busy} disabled={!uploads.length || busy || uploads.every((item) => item.status === 'done' || item.status === 'duplicate')}>{uploads.some((item) => item.status === 'failed') ? 'Retry failed uploads' : 'Upload and add to library'}</Button>
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
