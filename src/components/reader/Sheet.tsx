import { useEffect, useRef, type ReactNode } from 'react';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { Button } from '@/components/ui/button';

// FR-READ-7/11, NFR-A11Y-2: a bottom sheet for narrow screens (notes, contents, a comment). It stays above the
// software keyboard and the home indicator, closes with Esc or its Close button (never by a stray tap, so a
// draft inside survives), and gives focus back to whatever opened it.
export function Sheet({ label, onClose, children }: Readonly<{ label: string; onClose: () => void; children: ReactNode }>) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const inset = useKeyboardInset();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const target = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>('textarea, input, button');
    target?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={ref}
      open
      aria-label={label}
      className="fixed inset-x-0 m-0 w-full max-w-none z-50 flex max-h-[min(75dvh,640px)] flex-col gap-2 overflow-auto rounded-t-[16px] border border-border bg-raised p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] text-fg shadow-xl"
      style={{ bottom: inset }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-label text-fg">{label}</p>
        <Button variant="ghost" className="min-w-11 px-2" onClick={onClose}>Close</Button>
      </div>
      {children}
    </dialog>
  );
}
