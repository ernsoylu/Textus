import { useState } from 'react';
import { ANNOTATION_COLORS, highlightFill, inkPages, isDrawing, type AnnotationItem } from '@/hooks/useAnnotations';
import { annotationsToJson, annotationsToMarkdown, downloadText } from '@/lib/annotationExport';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ColorSwatch } from './ColorSwatch';
import { NoteCard } from './NoteCard';

// FR-READ-4/5: the open book's highlights and notes in the reader's side panel — filter, edit, jump, export.
export function AnnotationPanel({ items: all, onGoTo }: Readonly<{ items: AnnotationItem[]; onGoTo?: (a: AnnotationItem) => void }>) {
  // Pen strokes are summarized per page below the cards; freehand highlights are cards like text highlights.
  const items = all.filter((a) => !isDrawing(a));
  const drawings = inkPages(all);
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
            <Button variant="ghost" className="min-h-11 px-3 py-1" onClick={() => downloadText('annotations.md', annotationsToMarkdown([...shown, ...all.filter(isDrawing)]), 'text/markdown')}>Markdown</Button>
            <Button variant="ghost" className="min-h-11 px-3 py-1" onClick={() => downloadText('annotations.json', annotationsToJson([...shown, ...all.filter(isDrawing)]), 'application/json')}>JSON</Button>
          </div>
        )}
      </div>
      {items.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {ANNOTATION_COLORS.map((c) => (
            <ColorSwatch key={c} aria-pressed={colors.includes(c)} aria-label={`Show ${c} only`} selected={colors.includes(c)} fill={highlightFill(c)} onClick={() => toggle(c)} />
          ))}
          <Input aria-label="Filter notes" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-auto min-w-[120px] flex-1" />
        </div>
      )}
      {items.length === 0 && <p className="text-small text-muted">Select text, then right-click or use the bar that appears, to highlight it or add a comment.</p>}
      <div className="flex flex-col gap-2">{shown.map((a) => <NoteCard key={a.id} a={a} onGoTo={onGoTo && (() => onGoTo(a))} />)}</div>
      {items.length > 0 && shown.length === 0 && <p className="text-small text-muted">No notes match this filter.</p>}
      {drawings.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-label text-fg">Drawings</p>
          <div className="flex flex-wrap gap-1">
            {drawings.map((d) => (
              <Button key={d.page} variant="ghost" className="min-h-11 px-3 py-1" onClick={() => onGoTo?.(d.first)}>
                Page {d.page} · {d.count} {d.count === 1 ? 'stroke' : 'strokes'}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
