import { useState } from 'react';
import { useTags } from '@/hooks/useTags';
import { useCollections } from '@/hooks/useCollections';
import { useBulkActions } from '@/hooks/useBulkActions';
import { Button } from '@/components/ui/button';
import { ExportButton } from '@/components/library/ExportButton';
import type { WorkListItem } from '@/hooks/useWorks';

// FR-ORG-4: bulk tag / add to collection / export / delete for the selected works.
export function BulkBar({ selected, onDone }: Readonly<{ selected: WorkListItem[]; onDone: () => void }>) {
  const tags = useTags();
  const collections = useCollections();
  const { tag, addToCollection, deleteWorks } = useBulkActions();
  const [tagId, setTagId] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const recordIds = selected.flatMap((w) => w.recordIds);
  const error = tag.error ?? addToCollection.error ?? deleteWorks.error;
  const SELECT = 'rounded-8 border border-muted bg-dim p-3 text-body text-fg';

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-8 border border-border p-3">
      <p className="text-label text-fg">{selected.length} selected</p>
      <select aria-label="Tag to apply" className={SELECT} value={tagId} onChange={(e) => setTagId(e.target.value)}>
        <option value="">Tag…</option>
        {tags.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <Button variant="secondary" disabled={!tagId || !recordIds.length} isLoading={tag.isPending} onClick={() => tag.mutate({ recordIds, tagId })}>Apply tag</Button>
      <select aria-label="Collection to add to" className={SELECT} value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
        <option value="">Collection…</option>
        {collections.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <Button variant="secondary" disabled={!collectionId || !recordIds.length} isLoading={addToCollection.isPending} onClick={() => addToCollection.mutate({ recordIds, collectionId })}>Add to collection</Button>
      <ExportButton recordIds={recordIds} />
      <Button
        variant="danger"
        disabled={!selected.length}
        isLoading={deleteWorks.isPending}
        onClick={() => {
          if (window.confirm(`Delete ${selected.length} work(s), their records and files? This cannot be undone.`)) deleteWorks.mutate(selected.map((w) => w.workId), { onSuccess: onDone });
        }}
      >
        Delete
      </Button>
      <Button variant="ghost" onClick={onDone}>Cancel</Button>
      {error && <p className="w-full text-small text-red">{error.message}</p>}
    </div>
  );
}
