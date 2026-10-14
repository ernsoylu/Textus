import { useState, type FormEvent } from 'react';
import { ANNOTATION_COLORS, highlightFill } from '@/hooks/useAnnotations';
import { useOnline } from '@/hooks/useOnline';
import { UnsavedChangesGuard } from '@/components/ui/UnsavedChangesGuard';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { ColorSwatch } from './ColorSwatch';

// FR-READ-4: color + optional comment. `quote` is the selected text being highlighted.
// FR-READ-12: the comment is cleared only after the save succeeds; a failure keeps it, says why next to the
// button and turns the button into Retry. Cancelling a written comment asks first.
export function AnnotationForm({ label, quote, notice, autoFocus, onSubmit, onCancel, onDirtyChange }: Readonly<{
  label: string;
  quote?: string;
  /** A limit the reader should know before saving (e.g. a selection cut to one page). */
  notice?: string;
  autoFocus?: boolean;
  onSubmit: (color: string, note: string) => Promise<unknown>;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}>) {
  const online = useOnline();
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const dirty = note.trim() !== '';

  function edit(value: string) {
    setNote(value);
    onDirtyChange?.(value.trim() !== '' || !!error);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(color, note);
      setNote('');
      onDirtyChange?.(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save.';
      setError(navigator.onLine ? message : 'You’re offline. Not saved yet.');
      onDirtyChange?.(true);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    if (dirty) setDiscarding(true);
    else onCancel?.();
  }

  const offlineMessage = !online && !error ? 'Offline: saving will fail until you reconnect' : '';

  // The dialog sits outside the form: its buttons must not submit the comment.
  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-8 border border-border p-3">
        <UnsavedChangesGuard dirty={dirty || !!error} subject="comment" />
        {quote && <p className="line-clamp-4 font-serif text-small italic text-muted">“{quote}”</p>}
        {notice && <p className="text-small text-yellow">{notice}</p>}
        <div className="flex flex-wrap" role="radiogroup" aria-label="Color">
          {ANNOTATION_COLORS.map((c) => (
            <ColorSwatch key={c} role="radio" aria-checked={color === c} aria-label={c} selected={color === c} fill={highlightFill(c)} onClick={() => setColor(c)} />
          ))}
        </div>
        <textarea
          aria-label="Comment"
          placeholder="Comment (optional)"
          rows={2}
          value={note}
          data-autofocus={autoFocus || undefined}
          onChange={(e) => edit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleSubmit(e);
          }}
          className="w-full resize-y rounded-4 border border-muted bg-dim p-2 text-small text-fg"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="secondary" isLoading={saving}>{error ? 'Retry' : label}</Button>
          {onCancel && <Button type="button" variant="ghost" onClick={cancel}>Cancel</Button>}
          <span className="text-small text-muted" aria-live="polite">{saving ? 'Saving…' : offlineMessage}</span>
        </div>
        {error && <p role="alert" className="text-small text-red">Could not save: {error} Your comment is kept here.</p>}
      </form>
      <ConfirmDialog
        open={discarding}
        title="Discard this comment?"
        description="The comment you wrote has not been saved."
        confirmLabel="Discard"
        onConfirm={() => {
          setDiscarding(false);
          setNote('');
          setError(null);
          onDirtyChange?.(false);
          onCancel?.();
        }}
        onClose={() => setDiscarding(false)}
      />
    </>
  );
}
