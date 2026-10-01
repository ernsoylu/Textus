import { useState } from 'react';
import { useDeleteWork } from '@/hooks/useCatalogMutations';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

// FR-CAT-1: deletes a work after confirmation, then returns to the library.
export function DeleteWorkButton({ workId, title, kind = 'work' }: Readonly<{ workId: string; title: string; kind?: string }>) {
  const remove = useDeleteWork();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button variant="danger" onClick={() => setConfirming(true)}>Delete {kind}</Button>
      <ConfirmDialog
        open={confirming}
        title={`Delete "${title}"?`}
        description={`This removes the ${kind} with all its records, identifiers, credits, notes and reading progress. Its files are deleted from storage within a day. This cannot be undone.`}
        confirmLabel={`Delete ${kind}`}
        busy={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => remove.mutate(workId, { onSettled: () => setConfirming(false) })}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
