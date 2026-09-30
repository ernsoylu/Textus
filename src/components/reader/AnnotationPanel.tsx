import { useState } from 'react';
import { ANNOTATION_COLORS, highlightFill, type AnnotationItem } from '@/hooks/useAnnotations';
import { annotationsToJson, annotationsToMarkdown, downloadText } from '@/lib/annotationExport';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { NoteCard } from './NoteCard';

// FR-READ-4/5: the open book's highlights and notes in the reader's side panel — filter, edit, jump, export.
export function AnnotationPanel({ items, onGoTo }: Readonly<{ items: AnnotationItem[]; onGoTo?: (a: AnnotationItem) => void }>) {
  const [colors, setColors] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const shown = items.filter(
    (a) => (colors.length === 0 || colors.includes(a.color ?? 'yellow')) && (!needle || `${a.note ?? ''} ${a.highlighted_text ?? ''}`.toLowerCase().includes(needle)),
  );
  const toggle = (color: string) => setColors((prev) => (prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color]));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-label text-fg">Notes · {shown.length === items.length ? items.length : `${shown.length} of ${items.length}`}</p>
        {shown.length > 0 && (
          <div className="flex gap-1">
            <Button variant="ghost" className="min-h-8 px-2 py-1" onClick={() => downloadText('annotations.md', annotationsToMarkdown(shown), 'text/markdown')}>Markdown</Button>
            <Button variant="ghost" className="min-h-8 px-2 py-1" onClick={() => downloadText('annotations.json', annotationsToJson(shown), 'application/json')}>JSON</Button>
          </div>
        )}
      </div>
      {items.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {ANNOTATION_COLORS.map((c) => (
            <button key={c} type="button" aria-pressed={colors.includes(c)} aria-label={`Show ${c} only`} onClick={() => toggle(c)} style={{ backgroundColor: highlightFill(c) }} className={`h-5 w-5 rounded-full border ${colors.includes(c) ? 'border-fg ring-2 ring-fg' : 'border-transparent'}`} />
          ))}
          <Input aria-label="Filter notes" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-auto min-w-[120px] flex-1" />
        </div>
      )}
      {items.length === 0 && <p className="text-small text-muted">Select text and right-click to highlight it or add a comment.</p>}
      <div className="flex flex-col gap-2">{shown.map((a) => <NoteCard key={a.id} a={a} onGoTo={onGoTo && (() => onGoTo(a))} />)}</div>
      {items.length > 0 && shown.length === 0 && <p className="text-small text-muted">No notes match this filter.</p>}
    </div>
  );
}
