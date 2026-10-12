import type { ButtonHTMLAttributes } from 'react';

// NFR-A11Y-2: a 44 × 44 px hit box around a small color dot. `selected` is shown by a ring and a check mark,
// not by color alone; callers set the matching aria-checked / aria-pressed.
export function ColorSwatch({ fill, selected, className = '', ...props }: Readonly<{ fill: string; selected?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>>) {
  return (
    <button type="button" className={`group flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${className}`} {...props}>
      <span aria-hidden="true" style={{ backgroundColor: fill }} className={`flex h-7 w-7 items-center justify-center rounded-full border text-[13px] leading-none text-[#232a2e] group-hover:ring-2 group-hover:ring-muted ${selected ? 'border-fg ring-2 ring-fg' : 'border-border'}`}>
        {selected ? '✓' : ''}
      </span>
    </button>
  );
}
