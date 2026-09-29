import { Link } from 'react-router-dom';
import { useCollectionRecords, useReorderCollection, useSetCollectionMember } from '@/hooks/useCollections';
import { Button } from '@/components/ui/button';

// FR-ORG-2: a collection's records in their manual order, with move up/down and remove.
export function CollectionItems({ collectionId }: Readonly<{ collectionId: string }>) {
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
  if (data.length === 0) return <p className="text-small text-muted">Empty. Add records from a work’s page, or select works in the Library and use “Add to collection”.</p>;
  return (
    <ol className="flex flex-col gap-1">
      {data.map((r, i) => (
        <li key={r.recordId} className="flex flex-wrap items-center gap-2">
          <Link to={`/library/${r.workId}`} className="text-body text-fg underline">{r.title}</Link>
          <Button variant="ghost" aria-label={`Move ${r.title} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
          <Button variant="ghost" aria-label={`Move ${r.title} down`} disabled={i === data.length - 1} onClick={() => move(i, 1)}>↓</Button>
          <Button variant="ghost" onClick={() => remove.mutate({ collectionId, recordId: r.recordId, on: false })}>Remove</Button>
        </li>
      ))}
    </ol>
  );
}
