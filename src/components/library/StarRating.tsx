import { useEffect, useState } from 'react';

export function StarRating({ value, onChange, label = 'Your rating', disabled = false }: Readonly<{ value: number | null; onChange?: (value: number) => void; label?: string; disabled?: boolean }>) {
  const [draft, setDraft] = useState(value ?? 0.5);
  useEffect(() => setDraft(value ?? 0.5), [value]);
  return <div className="flex flex-col items-center gap-1">
    <div className="relative flex rounded-4 text-[28px] leading-[40px] focus-within:ring-2 focus-within:ring-green" aria-hidden={!onChange || undefined}>
      <div className="flex" aria-hidden="true">{[0, 1, 2, 3, 4].map((index) => <span key={index} className="relative inline-block w-9 text-center text-muted">★<span className="absolute inset-y-0 left-0 overflow-hidden text-yellow" style={{ width: `${Math.min(1, Math.max(0, (onChange ? (value == null && draft === 0.5 ? 0 : draft) : (value ?? 0)) - index)) * 100}%` }}><span className="block w-9 text-center">★</span></span></span>)}</div>
      {onChange && <input type="range" min="0.5" max="5" step="0.5" value={draft} aria-label={label} aria-valuetext={value == null ? 'Not rated; choose a half-star rating' : `${value} out of 5 stars`} onChange={(event) => setDraft(Number(event.target.value))} onPointerUp={(event) => onChange(Number(event.currentTarget.value))} onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) onChange(Number(event.currentTarget.value)); }} disabled={disabled} className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0" />}
    </div>
    <span className="text-small text-fg" aria-live={onChange ? "polite" : undefined}>{value == null ? 'Not rated' : `${value} / 5`}</span>
  </div>;
}
