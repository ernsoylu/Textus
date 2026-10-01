import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// A small floating panel at a screen point (a context menu, a comment bubble). It stays inside the viewport,
// closes on Esc or a press outside it, and is rendered in place, so it also shows inside a fullscreen reader.
export function Popover({ at, label, onClose, children, role = 'dialog' }: Readonly<{ at: { x: number; y: number }; label: string; onClose: () => void; children: ReactNode; role?: 'dialog' | 'menu' }>) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [pos, setPos] = useState(at);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const x = Math.max(8, Math.min(at.x, globalThis.innerWidth - width - 8));
    const y = at.y + height + 8 > globalThis.innerHeight ? Math.max(8, at.y - height - 8) : at.y + 4;
    setPos({ x, y });
  }, [at]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close.current();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close.current();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    ref.current?.querySelector<HTMLElement>('[data-autofocus], button, textarea, input')?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  return (
    <div ref={ref} role={role} aria-label={label} className="fixed z-50 max-h-[80vh] w-80 max-w-[calc(100vw-16px)] overflow-auto rounded-8 border border-border bg-raised p-3 text-fg shadow-xl" style={{ left: pos.x, top: pos.y }}>
      {children}
    </div>
  );
}
