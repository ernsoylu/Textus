import { useState } from 'react';
import { useRemoveIdentifier } from '@/hooks/useCatalogMutations';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';

// FR-CAT-4: a record's identifiers, each removable.
export function IdentifierList({ workId, recordId, identifiers }: Readonly<{ workId: string; recordId: string; identifiers: { scheme: string; normalized_value: string }[] }>) {
  const remove = useRemoveIdentifier(workId);
  const [target, setTarget] = useState<{ scheme: string; normalized_value: string } | null>(null);
  return (
    <>
      {identifiers.map((id) => (
        <div key={`${id.scheme}:${id.normalized_value}`} className="flex items-center gap-2">
          <p className="text-small text-green">{id.scheme.toUpperCase()}: {id.normalized_value}</p>
          <Button variant="ghost" aria-label={`Remove ${id.scheme.toUpperCase()} ${id.normalized_value}`} onClick={() => setTarget(id)}>Remove</Button>
        </div>
      ))}
      <ConfirmDialog
        open={!!target}
        title="Remove this identifier?"
        description={target ? `${target.scheme.toUpperCase()} ${target.normalized_value} is removed from this record. You can add it again later.` : ''}
        confirmLabel="Remove"
        busy={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => target && remove.mutate({ recordId, scheme: target.scheme, value: target.normalized_value }, { onSettled: () => setTarget(null) })}
        onClose={() => setTarget(null)}
      />
    </>
  );
}
