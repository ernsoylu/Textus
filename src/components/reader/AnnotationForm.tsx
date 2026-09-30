import { useState, type FormEvent } from 'react';
import { ANNOTATION_COLORS, highlightFill } from '@/hooks/useAnnotations';
import { Button } from '@/components/ui/button';

// FR-READ-4: color + optional comment. `quote` is the selected text being highlighted.
export function AnnotationForm({ label, quote, isLoading, autoFocus, onSubmit, onCancel }: Readonly<{ label: string; quote?: string; isLoading?: boolean; autoFocus?: boolean; onSubmit: (color: string, note: string) => void; onCancel?: () => void }>) {
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  const [note, setNote] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(color, note);
    setNote('');
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-8 border border-border p-3">
      {quote && <p className="line-clamp-4 font-serif text-small italic text-muted">“{quote}”</p>}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
        {ANNOTATION_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} style={{ backgroundColor: highlightFill(c) }} className={`h-6 w-6 rounded-full border ${color === c ? 'border-fg ring-2 ring-fg' : 'border-transparent'}`} />
        ))}
      </div>
      <textarea
        aria-label="Comment"
        placeholder="Comment (optional)"
        rows={2}
        value={note}
        data-autofocus={autoFocus || undefined}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(e);
        }}
        className="w-full resize-y rounded-4 border border-muted bg-dim p-2 text-small text-fg"
      />
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" isLoading={isLoading}>{label}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
