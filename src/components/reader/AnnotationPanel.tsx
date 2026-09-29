import { useState } from 'react';
import { ANNOTATION_COLORS, useUpdateAnnotation, useDeleteAnnotation, type AnnotationItem } from '@/hooks/useAnnotations';
import { annotationsToJson, annotationsToMarkdown, downloadText } from '@/lib/annotationExport';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

function Row({ a, onGoTo }: Readonly<{ a: AnnotationItem; onGoTo?: (a: AnnotationItem) => void }>) {
  const update = useUpdateAnnotation();
  const del = useDeleteAnnotation();
  const [note, setNote] = useState(a.note ?? '');
  const [confirming, setConfirming] = useState(false);
  const page = a.anchor_type === 'pdf_page' ? (a.anchor_data as { page?: number }).page : undefined;
  return (
    <li className="flex flex-col gap-1 rounded-8 border border-border p-3" style={{ borderLeft: `4px solid ${a.color ?? 'yellow'}` }}>
      {a.highlighted_text && <p className="text-small text-muted">“{a.highlighted_text}”</p>}
      <Input aria-label="Note" value={note} placeholder="Note" onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (a.note ?? '') && update.mutate({ id: a.id, note })} />
      <div className="flex items-center gap-2">
        {onGoTo && <Button variant="ghost" onClick={() => onGoTo(a)}>{page ? `Page ${page}` : 'Go to'}</Button>}
        <Button variant="ghost" onClick={() => setConfirming(true)}>Delete</Button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete this note?"
        description={a.highlighted_text ? `The highlight “${a.highlighted_text.slice(0, 80)}” and its note are removed.` : 'The note is removed.'}
        confirmLabel="Delete note"
        busy={del.isPending}
        error={del.error?.message}
        onConfirm={() => del.mutate(a.id, { onSettled: () => setConfirming(false) })}
        onClose={() => setConfirming(false)}
      />
    </li>
  );
}

// FR-READ-4/5: list, filter, edit, delete and export the annotations of the open asset (or of the whole
// library on the Notes page). The color chips and the search box narrow both the list and the export.
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
        <p className="text-label text-fg">Annotations · {shown.length === items.length ? items.length : `${shown.length} of ${items.length}`}</p>
        {shown.length > 0 && (
          <div className="flex gap-1">
            <Button variant="ghost" onClick={() => downloadText('annotations.md', annotationsToMarkdown(shown), 'text/markdown')}>Markdown</Button>
            <Button variant="ghost" onClick={() => downloadText('annotations.json', annotationsToJson(shown), 'application/json')}>JSON</Button>
          </div>
        )}
      </div>
      {items.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {ANNOTATION_COLORS.map((c) => (
            <button key={c} type="button" aria-pressed={colors.includes(c)} aria-label={`Show ${c} only`} onClick={() => toggle(c)} style={{ backgroundColor: c }} className={`h-6 w-6 rounded-full border ${colors.includes(c) ? 'border-fg ring-2 ring-fg' : 'border-muted'}`} />
          ))}
          <Input aria-label="Filter notes" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-auto min-w-[120px] flex-1" />
        </div>
      )}
      <ul className="flex flex-col gap-2">{shown.map((a) => <Row key={a.id} a={a} onGoTo={onGoTo} />)}</ul>
      {items.length > 0 && shown.length === 0 && <p className="text-small text-muted">No notes match this filter.</p>}
    </div>
  );
}
