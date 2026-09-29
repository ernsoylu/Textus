import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ModalDialog } from '@/components/ui/ModalDialog';

// Destructive (or plain) confirmations — Figma "delete …" and "signout" dialogs.
// `requireText` asks the user to type a word before the confirm button enables.
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
  const [typed, setTyped] = useState('');
  return (
    <ModalDialog open={open} title={title} onClose={onClose} onOpen={() => setTyped('')}>
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
    </ModalDialog>
  );
}
