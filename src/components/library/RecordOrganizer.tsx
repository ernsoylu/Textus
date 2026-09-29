import { useState, type FormEvent } from 'react';
import { useTags, useRecordTags, useCreateTag, useSetRecordTag } from '@/hooks/useTags';
import { useCollections, useRecordCollections, useSetCollectionMember } from '@/hooks/useCollections';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const DEFAULT_COLOR = '#4ade80';

// FR-ORG-1/2: tag chips (toggle) plus collection membership for one record.
export function RecordOrganizer({ recordId }: { recordId: string }) {
  const tags = useTags();
  const applied = useRecordTags(recordId);
  const createTag = useCreateTag();
  const setTag = useSetRecordTag(recordId);
  const collections = useCollections();
  const memberOf = useRecordCollections(recordId);
  const setMember = useSetCollectionMember();
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const tagId = await createTag.mutateAsync({ name, color });
    setTag.mutate({ tagId, on: true });
    setName('');
  }

  const appliedIds = new Set(applied.data);
  const memberIds = new Set(memberOf.data);
  const error = createTag.error ?? setTag.error ?? setMember.error;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {tags.data?.map((t) => {
          const on = appliedIds.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => setTag.mutate({ tagId: t.id, on: !on })}
              style={{ borderColor: t.color ?? undefined, backgroundColor: on ? (t.color ?? undefined) : undefined }}
              className={`rounded-8 border px-2 py-1 text-small ${on ? 'text-dim' : 'text-fg'}`}
            >
              {t.name}
            </button>
          );
        })}
      </div>
      <form onSubmit={handleCreate} className="flex flex-wrap items-start gap-2">
        <Input placeholder="New tag" value={name} onChange={(e) => setName(e.target.value)} className="w-auto min-w-[160px]" />
        <input type="color" aria-label="Tag color" value={color} onChange={(e) => setColor(e.target.value)} className="h-11 w-11 rounded-8 border border-muted bg-dim" />
        <Button type="submit" variant="secondary" isLoading={createTag.isPending} disabled={!name.trim()}>
          Add tag
        </Button>
      </form>
      {collections.data && collections.data.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {collections.data.map((c) => (
            <label key={c.id} className="flex items-center gap-1 text-small text-fg">
              <input type="checkbox" checked={memberIds.has(c.id)} onChange={(e) => setMember.mutate({ collectionId: c.id, recordId, on: e.target.checked })} />
              {c.name}
            </label>
          ))}
        </div>
      )}
      {error && <p className="text-small text-red">{error.message}</p>}
    </div>
  );
}
