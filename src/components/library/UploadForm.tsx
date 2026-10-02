import { useRef, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { uploadFile, type UploadRole } from '@/hooks/useUploadAsset';
import { Button } from '@/components/ui/button';

const ROLES: UploadRole[] = ['primary', 'supplement', 'cover'];

interface Item {
  id: number;
  file: File;
  role: UploadRole;
  status: 'uploading' | 'done' | 'failed';
  progress: number;
  message?: string;
}

let nextId = 1;

// FR-FILE-1/5/6: drop or pick several files; each shows its own progress and, when the server
// rejects it, why — with a retry. Files upload one after another.
export function UploadForm({ recordId }: Readonly<{ recordId: string }>) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<UploadRole>('primary');
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const patch = (id: number, change: Partial<Item>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...change } : i)));

  function run(item: Item) {
    patch(item.id, { status: 'uploading', progress: 0, message: undefined });
    chain.current = chain.current.then(async () => {
      try {
        const result = await uploadFile(recordId, item.role, item.file, (progress) => patch(item.id, { progress }));
        if (result.status === 'duplicate') throw new Error('This file already belongs to another book in your library.');
        patch(item.id, { status: 'done', progress: 1 });
        await queryClient.invalidateQueries({ queryKey: ['works'] });
      } catch (e) {
        patch(item.id, { status: 'failed', message: e instanceof Error ? e.message : 'Upload failed.' });
      }
    });
  }

  function add(files: FileList | File[]) {
    const added = [...files].map((file): Item => ({ id: nextId++, file, role, status: 'uploading', progress: 0 }));
    setItems((prev) => [...prev, ...added]);
    added.forEach(run);
    if (inputRef.current) inputRef.current.value = '';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) add(e.dataTransfer.files);
  }

  return (
    <div className="flex flex-col gap-2">
      <section
        aria-label="Upload files"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-wrap items-center gap-2 rounded-8 border border-dashed p-3 ${dragging ? 'border-green bg-green-bg' : 'border-muted'}`}
      >
        <select aria-label="File role" className="rounded-8 border border-muted bg-dim p-3 text-body text-fg" value={role} onChange={(e) => setRole(e.target.value as UploadRole)}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => e.target.files && add(e.target.files)} />
        <Button variant="secondary" onClick={() => inputRef.current?.click()}>Choose files</Button>
        <p className="text-small text-muted">or drop them here</p>
      </section>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-1 text-small text-fg">
            <span className="break-words">{item.file.name}</span>
            <span className="text-muted">{item.role}</span>
            <progress aria-label={`Uploading ${item.file.name}`} value={item.progress} max={1} className="h-3 w-full accent-green" />
            <span className="text-muted">{Math.round(item.progress * 100)}% · {(item.file.size * item.progress / 1_048_576).toFixed(1)} / {(item.file.size / 1_048_576).toFixed(1)} MB</span>
            {item.status === 'done' && <span className="text-green">Uploaded</span>}
            {item.status === 'failed' && (
              <>
                <span className="text-red">{item.message}</span>
                <Button variant="ghost" onClick={() => run(item)}>Retry</Button>
              </>
            )}
            {item.status !== 'uploading' && <Button variant="ghost" aria-label={`Dismiss ${item.file.name}`} onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}>×</Button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
