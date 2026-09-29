import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useCreateTag, useTagList } from '@/hooks/useTags';
import { TagRow } from '@/components/library/TagRow';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Figma "tags": all tags, create / rename / recolor / delete (FR-ORG-1).
export function Tags() {
  const { data, isLoading, error } = useTagList();
  const create = useCreateTag();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#4ade80');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim()) create.mutate({ name, color }, { onSuccess: () => setName('') });
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link to="/library" className="text-small text-muted underline">Library</Link>
        <p className="font-serif text-title text-fg">Tags</p>
        <p className="text-body text-muted">Colored labels you can put on any record.</p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-start gap-2">
        <input type="color" aria-label="New tag color" value={color} onChange={(e) => setColor(e.target.value)} className="h-11 w-11 rounded-8 border border-muted bg-dim" />
        <Input placeholder="New tag" value={name} onChange={(e) => setName(e.target.value)} error={create.error?.message} className="w-auto min-w-[200px]" />
        <Button type="submit" isLoading={create.isPending} disabled={!name.trim()}>Create tag</Button>
      </form>
      {isLoading && <p className="text-body text-muted">Loading…</p>}
      {error && <p className="text-body text-red">Could not load tags: {error.message}</p>}
      {data?.length === 0 && <p className="text-body text-muted">No tags yet. Create one above, then put it on records from a work’s page.</p>}
      <ul className="flex flex-col gap-2">{data?.map((t) => <TagRow key={t.id} tag={t} />)}</ul>
    </div>
  );
}
