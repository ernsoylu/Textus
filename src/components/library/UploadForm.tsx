import { useRef, useState } from 'react';
import { useUploadAsset } from '@/hooks/useUploadAsset';

const ROLES = ['primary', 'supplement', 'cover'] as const;

export function UploadForm({ recordId }: Readonly<{ recordId: string }>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<(typeof ROLES)[number]>('primary');
  const mutation = useUploadAsset(recordId);

  function handleFile(file: File | undefined) {
    if (!file) return;
    mutation.mutate({ role, file }, { onSuccess: () => inputRef.current && (inputRef.current.value = '') });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="rounded-8 border border-muted bg-dim p-4 text-body text-fg"
        value={role}
        onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <input
        ref={inputRef}
        type="file"
        onChange={(e) => handleFile(e.target.files?.[0])}
        disabled={mutation.isPending}
        className="text-small text-fg"
      />
      {mutation.isPending && <p className="text-small text-muted">Uploading…</p>}
      {mutation.isError && <p className="text-small text-red">{mutation.error.message}</p>}
    </div>
  );
}
