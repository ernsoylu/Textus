import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useUpdateTag, useDeleteTag } from '@/hooks/useTags';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Figma "tag edit" / "delete tag": rename and delete; colors are assigned when creating tags.
export function TagRow({ tag }: Readonly<{ tag: { id: string; name: string; color: string | null; count: number; collections: number; notes: number } }>) {
  const update = useUpdateTag();
  const remove = useDeleteTag();
  const [name, setName] = useState(tag.name);
  const [confirming, setConfirming] = useState(false);
  const dirty = name.trim() !== tag.name;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const usage = [plural(tag.count, 'record'), plural(tag.collections, 'collection'), plural(tag.notes, 'note')].join(' · ');

  return (
    <li className="flex flex-wrap items-start gap-2 rounded-8 border border-border p-3">
      <span aria-hidden="true" style={{ backgroundColor: tag.color ?? undefined }} className="h-3 w-3 shrink-0 self-center rounded-full bg-green" />
      <Input aria-label={`Name of ${tag.name}`} value={name} onChange={(e) => setName(e.target.value)} error={update.error?.message} className="w-auto min-w-[160px]" />
      <Link to={`/tags/${tag.id}`} className="self-center text-small text-green underline">{usage}</Link>
      <Button variant="secondary" disabled={!dirty || !name.trim()} isLoading={update.isPending} onClick={() => update.mutate({ id: tag.id, name })}>Save</Button>
      <Button variant="ghost" onClick={() => setConfirming(true)}>Delete</Button>
      <ConfirmDialog
        open={confirming}
        title={`Delete the tag "${tag.name}"?`}
        description={`It is removed from ${usage}. The records, collections and notes themselves are not touched.`}
        confirmLabel="Delete tag"
        busy={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => remove.mutate(tag.id, { onSettled: () => setConfirming(false) })}
        onClose={() => setConfirming(false)}
      />
    </li>
  );
}
