import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCollection, useDeleteCollection, useUpdateCollection } from '@/hooks/useCollections';
import { CollectionItems } from '@/components/library/CollectionItems';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { UnsavedChangesGuard } from '@/components/ui/UnsavedChangesGuard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Figma "collection" + "collection edit" + "reorder": one shelf, editable, in manual order.
export function CollectionDetail() {
  const { collectionId } = useParams<{ collectionId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useCollection(collectionId);
  const update = useUpdateCollection(collectionId!);
  const remove = useDeleteCollection();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setName(data.name);
      setDescription(data.description ?? '');
    }
  }, [data]);

  function save(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    if (name.trim()) update.mutate({ name, description }, { onSuccess: () => setSaved(true) });
  }

  const dirty = !!data && (name.trim() !== data.name || description.trim() !== (data.description ?? ''));

  if (isLoading) return <p className="text-body text-muted">Loading…</p>;
  if (error || !data) return <p className="text-body text-red">This collection could not be found. <Link to="/collections" className="underline">Back to collections</Link></p>;

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <Link to="/collections" className="text-small text-muted underline">Collections</Link>
      <h1 className="font-serif text-title text-fg">{data.name}</h1>
      <form onSubmit={save} className="flex flex-col gap-2">
        <label className="flex flex-col gap-2 text-small text-fg">Collection name<Input required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="flex flex-col gap-2 text-small text-fg">Description (optional)<textarea rows={2} placeholder="What belongs on this shelf?" value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-8 border border-muted bg-dim p-4 text-body text-fg" /></label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="secondary" isLoading={update.isPending} disabled={!name.trim() || !dirty}>Save collection</Button>
          <Button type="button" variant="danger" onClick={() => setConfirming(true)}>Delete collection</Button>
          {saved && <output className="text-small text-green">Saved.</output>}
          {update.error && <p className="text-small text-red">{update.error.message}</p>}
        </div>
      </form>
      <section className="flex flex-col gap-2">
        <h2 className="text-heading text-fg">On this shelf</h2>
        <CollectionItems collectionId={data.id} />
      </section>
      <UnsavedChangesGuard dirty={dirty && !!name.trim()} subject="collection" onSave={() => update.mutateAsync({ name, description })} />
      <ConfirmDialog
        open={confirming}
        title={`Delete "${data.name}"?`}
        description="The shelf is deleted. The records on it stay in your library."
        confirmLabel="Delete collection"
        busy={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => remove.mutate(data.id, { onSuccess: () => navigate('/collections'), onSettled: () => setConfirming(false) })}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
