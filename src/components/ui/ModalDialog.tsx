import { useEffect, useId, useRef, type ReactNode } from 'react';

// The <dialog> plumbing shared by every modal: showModal()/close() follow `open`, and the browser
// supplies the focus trap, Esc and inert background. `onClose` fires for Esc as well as our buttons.
export function ModalDialog({ open, title, onClose, onOpen, children }: Readonly<{ open: boolean; title: string; onClose: () => void; onOpen?: () => void; children: ReactNode }>) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      onOpen?.();
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
    // onOpen only resets local state when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} className="m-auto w-full max-w-[440px] rounded-8 border border-border bg-raised p-6 text-fg backdrop:bg-black/60">
      <div className="flex flex-col gap-4">
        <p id={titleId} className="font-serif text-heading text-fg">{title}</p>
        {children}
      </div>
    </dialog>
  );
}
