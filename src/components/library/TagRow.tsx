import { useState } from 'react';
import { useUpdateTag, useDeleteTag } from '@/hooks/useTags';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// Figma "tag edit" / "delete tag": rename, recolor, delete.
export function TagRow({ tag }: Readonly<{ tag: { id: string; name: string; color: string | null; count: number } }>) {
  const update = useUpdateTag();
  const remove = useDeleteTag();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color ?? '#4ade80');
  const [confirming, setConfirming] = useState(false);
  const dirty = name.trim() !== tag.name || color !== (tag.color ?? '#4ade80');

  return (
    <li className="flex flex-wrap items-start gap-2 rounded-8 border border-border p-3">
      <input type="color" aria-label={`Color of ${tag.name}`} value={color} onChange={(e) => setColor(e.target.value)} className="h-11 w-11 rounded-8 border border-muted bg-dim" />
      <Input aria-label={`Name of ${tag.name}`} value={name} onChange={(e) => setName(e.target.value)} error={update.error?.message} className="w-auto min-w-[160px]" />
      <p className="self-center text-small text-muted">{tag.count} {tag.count === 1 ? 'record' : 'records'}</p>
      <Button variant="secondary" disabled={!dirty || !name.trim()} isLoading={update.isPending} onClick={() => update.mutate({ id: tag.id, name, color })}>Save</Button>
      <Button variant="ghost" onClick={() => setConfirming(true)}>Delete</Button>
      <ConfirmDialog
        open={confirming}
        title={`Delete the tag "${tag.name}"?`}
        description={`It is removed from ${tag.count} ${tag.count === 1 ? 'record' : 'records'}. The records themselves are not touched.`}
        confirmLabel="Delete tag"
        busy={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => remove.mutate(tag.id, { onSettled: () => setConfirming(false) })}
        onClose={() => setConfirming(false)}
      />
    </li>
  );
}
