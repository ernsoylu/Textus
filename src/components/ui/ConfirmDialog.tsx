import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// A native <dialog> (focus trap, Esc, inert background come from the browser) for destructive
// confirmations — Figma "delete …" dialogs. `requireText` asks the user to type a word first.
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  requireText?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel = 'Cancel', danger = true, requireText, busy, error, onConfirm, onClose }: Readonly<ConfirmDialogProps>) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState('');
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setTyped('');
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-full max-w-[440px] rounded-8 border border-border bg-raised p-6 text-fg backdrop:bg-black/60"
    >
      <div className="flex flex-col gap-4">
        <p id={titleId} className="font-serif text-heading text-fg">{title}</p>
        <p className="text-body text-muted">{description}</p>
        {requireText && (
          <label className="flex flex-col gap-2 text-small text-fg">
            Type {requireText} to confirm
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
        )}
        {error && <p className="text-small text-red" role="alert">{error}</p>}
        <div className="flex gap-2">
          <Button variant={danger ? 'danger' : 'primary'} isLoading={busy} disabled={!!requireText && typed !== requireText} onClick={onConfirm}>{confirmLabel}</Button>
          <Button variant="secondary" onClick={onClose}>{cancelLabel}</Button>
        </div>
      </div>
    </dialog>
  );
}
