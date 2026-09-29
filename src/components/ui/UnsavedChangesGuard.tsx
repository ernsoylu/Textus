import { useEffect, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { ModalDialog } from '@/components/ui/ModalDialog';
import { Button } from '@/components/ui/button';

// Figma "unsaved": "Keep your changes?" — blocks leaving a screen with edits (in-app navigation via the
// router, and closing the tab via beforeunload). `onSave` enables "Save and leave".
export function UnsavedChangesGuard({ dirty, subject, onSave }: Readonly<{ dirty: boolean; subject: string; onSave?: () => Promise<unknown> }>) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    globalThis.addEventListener('beforeunload', warn);
    return () => globalThis.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function saveAndLeave() {
    setSaving(true);
    setError(null);
    try {
      await onSave?.();
      blocker.proceed?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalDialog open={blocker.state === 'blocked'} title="Keep your changes?" onClose={() => blocker.reset?.()}>
      <p className="text-body text-muted">You have unsaved edits to this {subject}.</p>
      {error && <p className="text-small text-red" role="alert">{error}</p>}
      <div className="flex flex-col gap-2">
        {onSave && <Button isLoading={saving} onClick={saveAndLeave}>Save and leave</Button>}
        <Button variant="secondary" onClick={() => blocker.reset?.()}>Keep editing</Button>
        <Button variant="danger" onClick={() => blocker.proceed?.()}>Discard changes</Button>
      </div>
    </ModalDialog>
  );
}
