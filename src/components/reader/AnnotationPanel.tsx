import { useState } from 'react';
import { useUpdateAnnotation, useDeleteAnnotation, type AnnotationItem } from '@/hooks/useAnnotations';
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

// FR-READ-4/5: list, edit, delete and export the annotations of the open asset.
export function AnnotationPanel({ items, onGoTo }: Readonly<{ items: AnnotationItem[]; onGoTo?: (a: AnnotationItem) => void }>) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-label text-fg">Annotations · {items.length}</p>
        {items.length > 0 && (
          <div className="flex gap-1">
            <Button variant="ghost" onClick={() => downloadText('annotations.md', annotationsToMarkdown(items), 'text/markdown')}>Markdown</Button>
            <Button variant="ghost" onClick={() => downloadText('annotations.json', annotationsToJson(items), 'application/json')}>JSON</Button>
          </div>
        )}
      </div>
      <ul className="flex flex-col gap-2">{items.map((a) => <Row key={a.id} a={a} onGoTo={onGoTo} />)}</ul>
    </div>
  );
}
