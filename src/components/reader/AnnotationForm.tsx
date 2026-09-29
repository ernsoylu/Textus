import { useState, type FormEvent } from 'react';
import { ANNOTATION_COLORS } from '@/hooks/useAnnotations';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// FR-READ-4: color + optional note. `quote` is the selected text for an EPUB highlight.
export function AnnotationForm({ label, quote, isLoading, onSubmit }: { label: string; quote?: string; isLoading?: boolean; onSubmit: (color: string, note: string) => void }) {
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0]);
  const [note, setNote] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(color, note);
    setNote('');
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded-8 border border-border p-3">
      {quote && <p className="text-small text-muted">“{quote}”</p>}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
        {ANNOTATION_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)} style={{ backgroundColor: c }} className={`h-6 w-6 rounded-full border ${color === c ? 'border-fg ring-2 ring-fg' : 'border-muted'}`} />
        ))}
      </div>
      <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button type="submit" variant="secondary" isLoading={isLoading}>{label}</Button>
    </form>
  );
}
