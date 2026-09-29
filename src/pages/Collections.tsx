import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useCollections, useCreateCollection, useDeleteCollection, useCollectionRecords, useReorderCollection, useSetCollectionMember } from '@/hooks/useCollections';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

function CollectionItems({ collectionId }: Readonly<{ collectionId: string }>) {
  const { data } = useCollectionRecords(collectionId);
  const reorder = useReorderCollection(collectionId);
  const remove = useSetCollectionMember();

  function move(index: number, delta: -1 | 1) {
    if (!data) return;
    const ids = data.map((r) => r.recordId);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate(ids);
  }

  if (!data) return <p className="text-small text-muted">Loading…</p>;
  if (data.length === 0) return <p className="text-small text-muted">Empty. Add records from a work's page.</p>;
  return (
    <ol className="flex flex-col gap-1">
      {data.map((r, i) => (
        <li key={r.recordId} className="flex items-center gap-2">
          <Link to={`/library/${r.workId}`} className="text-body text-fg underline">{r.title}</Link>
          <Button variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
          <Button variant="ghost" aria-label="Move down" disabled={i === data.length - 1} onClick={() => move(i, 1)}>↓</Button>
          <Button variant="ghost" onClick={() => remove.mutate({ collectionId, recordId: r.recordId, on: false })}>Remove</Button>
        </li>
      ))}
    </ol>
  );
}

// FR-ORG-2: collections with manual ordering.
export function Collections() {
  const { data, isLoading, error } = useCollections();
  const create = useCreateCollection();
  const del = useDeleteCollection();
  const [name, setName] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(name, { onSuccess: () => setName('') });
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <p className="text-heading text-fg">Collections</p>
      <form onSubmit={handleSubmit} className="flex items-start gap-2">
        <Input placeholder="New collection" value={name} onChange={(e) => setName(e.target.value)} error={create.error?.message} />
        <Button type="submit" isLoading={create.isPending} disabled={!name.trim()}>Create</Button>
      </form>
      {isLoading && <p className="text-body text-muted">Loading…</p>}
      {error && <p className="text-body text-red">Could not load collections: {error.message}</p>}
      {data?.length === 0 && <p className="text-body text-muted">No collections yet.</p>}
      {data?.map((c) => (
        <section key={c.id} className="flex flex-col gap-2 rounded-8 border border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-label text-fg">{c.name} · {c.count}</p>
            <Button variant="danger" isLoading={del.isPending} onClick={() => { if (window.confirm(`Delete "${c.name}"? Records stay in your library.`)) del.mutate(c.id); }}>Delete</Button>
          </div>
          <CollectionItems collectionId={c.id} />
        </section>
      ))}
    </div>
  );
}
