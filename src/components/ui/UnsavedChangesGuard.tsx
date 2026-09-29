import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import { ModalDialog } from '@/components/ui/ModalDialog';
import { Button } from '@/components/ui/button';

// Figma "unsaved": "Keep your changes?" — blocks leaving a screen that has unsaved edits (in-app navigation via
// the router, and closing the tab via beforeunload).
//
// React Router allows a single blocker at a time, but a page can hold several forms (a work and each of its
// editions), so forms register with one provider that owns the blocker and the dialog. A form's `onSave` enables
// "Save and leave"; with several dirty forms it saves each in turn.
interface Entry {
  dirty: boolean;
  subject: string;
  onSave?: () => Promise<unknown>;
}

const Registry = createContext<Map<string, Entry> | null>(null);

const dirtyEntries = (registry: Map<string, Entry>) => [...registry.values()].filter((e) => e.dirty);

export function UnsavedChangesProvider({ children }: Readonly<{ children: ReactNode }>) {
  const registry = useRef(new Map<string, Entry>());
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && dirtyEntries(registry.current).length > 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirtyEntries(registry.current).length) e.preventDefault();
    };
    globalThis.addEventListener('beforeunload', warn);
    return () => globalThis.removeEventListener('beforeunload', warn);
  }, []);

  const dirty = blocker.state === 'blocked' ? dirtyEntries(registry.current) : [];
  const subjects = [...new Set(dirty.map((e) => e.subject))];
  const canSave = dirty.length > 0 && dirty.every((e) => e.onSave);

  async function saveAndLeave() {
    setSaving(true);
    setError(null);
    try {
      for (const entry of dirty) await entry.onSave?.();
      blocker.proceed?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Registry.Provider value={registry.current}>
      {children}
      <ModalDialog open={blocker.state === 'blocked'} title="Keep your changes?" onClose={() => blocker.reset?.()}>
        <p className="text-body text-muted">You have unsaved edits to this {subjects.join(' and ') || 'page'}.</p>
        {error && <p className="text-small text-red" role="alert">{error}</p>}
        <div className="flex flex-col gap-2">
          {canSave && <Button isLoading={saving} onClick={saveAndLeave}>Save and leave</Button>}
          <Button variant="secondary" onClick={() => blocker.reset?.()}>Keep editing</Button>
          <Button variant="danger" onClick={() => blocker.proceed?.()}>Discard changes</Button>
        </div>
      </ModalDialog>
    </Registry.Provider>
  );
}

// Render one per editable form; it draws nothing itself.
export function UnsavedChangesGuard({ dirty, subject, onSave }: Readonly<{ dirty: boolean; subject: string; onSave?: () => Promise<unknown> }>) {
  const registry = useContext(Registry);
  const id = useId();
  useEffect(() => {
    registry?.set(id, { dirty, subject, onSave });
    return () => {
      registry?.delete(id);
    };
  }, [registry, id, dirty, subject, onSave]);
  return null;
}
