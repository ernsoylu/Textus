import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useCollections, useCreateCollection } from '@/hooks/useCollections';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Figma "collections": every shelf; each opens its own page (FR-ORG-2).
export function Collections() {
  const { data, isLoading, error } = useCollections();
  const create = useCreateCollection();
  const [name, setName] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) create.mutate(name, { onSuccess: () => setName('') });
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
      {data?.length === 0 && <p className="text-body text-muted">No collections yet. A collection is a shelf you order by hand.</p>}
      <ul className="flex flex-col gap-2">
        {data?.map((c) => (
          <li key={c.id}>
            <Link to={`/collections/${c.id}`} className="flex flex-col gap-1 rounded-8 border border-border p-4 hover:bg-raised">
              <span className="text-label text-fg">{c.name}</span>
              <span className="text-small text-muted">{c.count} {c.count === 1 ? 'record' : 'records'}{c.description ? ` · ${c.description}` : ''}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
