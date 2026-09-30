import { useState, type FormEvent } from 'react';
import { useCreateTag, useTags } from '@/hooks/useTags';

// FR-ORG-1: the tags on one item (a note, a collection) as removable chips, plus a menu to add an existing tag
// or create a new one. The same tags label records, collections and notes.
export function TagPicker({ selected, onToggle, busy }: Readonly<{ selected: string[]; onToggle: (tagId: string, on: boolean) => Promise<unknown> | void; busy?: boolean }>) {
  const tags = useTags();
  const create = useCreateTag();
  const [name, setName] = useState('');
  const byId = new Map((tags.data ?? []).map((t) => [t.id, t]));
  const available = (tags.data ?? []).filter((t) => !selected.includes(t.id));

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      const id = await create.mutateAsync({ name });
      await onToggle(id, true);
      setName('');
    } catch { /* shown below */ }
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {selected.map((id) => {
        const tag = byId.get(id);
        if (!tag) return null;
        return (
          <span key={id} className="inline-flex items-center gap-1 rounded-4 border px-1.5 py-0.5 text-small text-fg" style={{ borderColor: tag.color ?? undefined }}>
            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color ?? undefined }} />
            {tag.name}
            <button type="button" disabled={busy} aria-label={`Remove tag ${tag.name}`} onClick={() => void onToggle(id, false)} className="px-0.5 text-muted hover:text-red">×</button>
          </span>
        );
      })}
      <details className="relative">
        <summary className="cursor-pointer list-none rounded-4 px-1.5 py-0.5 text-small text-muted hover:bg-bg hover:text-fg">+ Tag</summary>
        <div className="absolute left-0 z-30 mt-1 flex w-56 flex-col gap-1 rounded-8 border border-border bg-raised p-2 shadow-lg">
          {available.map((t) => (
            <button key={t.id} type="button" disabled={busy} onClick={() => void onToggle(t.id, true)} className="flex items-center gap-2 rounded-4 px-2 py-1 text-left text-small text-fg hover:bg-bg">
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color ?? undefined }} />
              {t.name}
            </button>
          ))}
          <form onSubmit={(e) => void handleCreate(e)} className="flex gap-1 border-t border-border pt-2">
            <input aria-label="New tag" placeholder="New tag" value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 rounded-4 border border-muted bg-dim px-2 py-1 text-small text-fg" />
            <button type="submit" disabled={!name.trim() || create.isPending} className="rounded-4 bg-green-bg px-2 text-small text-green disabled:opacity-60">Add</button>
          </form>
          {create.error && <p className="text-small text-red">{create.error.message}</p>}
        </div>
      </details>
    </div>
  );
}
