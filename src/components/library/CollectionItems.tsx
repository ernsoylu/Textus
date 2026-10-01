import { Link } from 'react-router-dom';
import { useCollectionRecords, useReorderCollection, useSetCollectionMember } from '@/hooks/useCollections';
import { Button } from '@/components/ui/button';

// FR-ORG-2: a collection's records in their manual order, with move up/down and remove.
export function CollectionItems({ collectionId }: Readonly<{ collectionId: string }>) {
  const { data, error } = useCollectionRecords(collectionId);
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

  if (error) return <p role="alert" className="text-small text-red">Could not load this collection: {error.message}</p>;
  if (!data) return <p role="status" className="text-small text-muted">Loading…</p>;
  if (data.length === 0) return <p className="text-small text-muted">Empty. Add records from a work’s page, or select works in the Library and use “Add to collection”.</p>;
  return (
    <div className="flex flex-col gap-3">
    {(reorder.error || remove.error) && <p role="alert" className="text-small text-red">{reorder.error?.message || remove.error?.message}</p>}
    <ol className="flex flex-col gap-2">
      {data.map((r, i) => (
        <li key={r.recordId} className="flex flex-wrap items-center justify-between gap-2 rounded-8 border border-border p-3">
          <Link to={`/library/${r.workId}`} className="min-w-0 flex-1 break-words text-body text-fg underline">{r.title}</Link>
          <div className="flex items-center gap-1">
          <Button variant="ghost" aria-label={`Move ${r.title} up`} disabled={i === 0 || reorder.isPending || remove.isPending} onClick={() => move(i, -1)}>↑</Button>
          <Button variant="ghost" aria-label={`Move ${r.title} down`} disabled={i === data.length - 1 || reorder.isPending || remove.isPending} onClick={() => move(i, 1)}>↓</Button>
          <Button variant="ghost" aria-label={`Remove ${r.title} from collection`} disabled={reorder.isPending || remove.isPending} onClick={() => remove.mutate({ collectionId, recordId: r.recordId, on: false })}>Remove</Button>
          </div>
        </li>
      ))}
    </ol>
    </div>
  );
}
