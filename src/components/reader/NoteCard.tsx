import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ANNOTATION_COLORS, annotationHref, bookTitle, highlightFill, noteLocation, useDeleteAnnotation, useSetAnnotationTag, useUpdateAnnotation, type AnnotationItem } from '@/hooks/useAnnotations';
import { TagPicker } from '@/components/library/TagPicker';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';

// FR-READ-4 / FR-ORG-1: one highlight or note, fully editable in place — color, comment, tags — with a way back
// into the book. Used in the reader's comment bubble and side panel and on the Notes page.
export function NoteCard({ a, onGoTo, showBook, autoFocus, inBook, onDeleted }: Readonly<{ a: AnnotationItem; onGoTo?: () => void; showBook?: boolean; autoFocus?: boolean; inBook?: boolean; onDeleted?: () => void }>) {
  const update = useUpdateAnnotation();
  const del = useDeleteAnnotation();
  const setTag = useSetAnnotationTag();
  const [note, setNote] = useState(a.note ?? '');
  const [confirming, setConfirming] = useState(false);
  const color = a.color ?? 'yellow';
  const where = noteLocation(a);
  const dirty = note.trim() !== (a.note ?? '');

  useEffect(() => setNote(a.note ?? ''), [a.note]);

  const save = () => dirty && update.mutate({ id: a.id, note: note.trim() });

  return (
    <article className="flex flex-col gap-2 rounded-8 border border-border bg-surface p-3" style={{ borderLeft: `4px solid ${highlightFill(color)}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showBook ? <Link to={`/library/${a.records?.work_id}`} className="min-w-0 truncate text-label text-fg hover:underline">{bookTitle(a)}</Link> : <span className="text-small text-muted">{where}</span>}
        <div className="flex gap-1" role="radiogroup" aria-label="Highlight color">
          {ANNOTATION_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => color !== c && update.mutate({ id: a.id, color: c })} style={{ backgroundColor: highlightFill(c) }} className={`h-4 w-4 rounded-full border ${color === c ? 'border-fg ring-2 ring-fg' : 'border-transparent'}`} />
          ))}
        </div>
      </div>
      {a.highlighted_text && <blockquote className="line-clamp-6 border-l-2 border-border pl-2 font-serif text-small italic text-muted">{a.highlighted_text}</blockquote>}
      <textarea
        aria-label="Comment"
        placeholder="Add a comment…"
        rows={note ? Math.min(8, note.split('\n').length + 1) : 2}
        value={note}
        autoFocus={autoFocus}
        data-autofocus={autoFocus || undefined}
        onChange={(e) => setNote(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
        }}
        className="w-full resize-y rounded-4 border border-muted bg-dim p-2 text-small text-fg"
      />
      <TagPicker selected={a.annotation_tags.map((t) => t.tag_id)} busy={setTag.isPending} onToggle={(tagId, on) => setTag.mutateAsync({ annotationId: a.id, tagId, on })} />
      <div className="flex flex-wrap items-center gap-1">
        {showBook && where && <span className="text-small text-muted">{where}</span>}
        <span className="text-small text-muted">{a.created_at ? new Date(a.created_at).toLocaleDateString() : ''}</span>
        <span className="flex-1" />
        {dirty && <Button variant="secondary" className="min-h-8 px-2 py-1" isLoading={update.isPending} onClick={save}>Save</Button>}
        {onGoTo && <Button variant="ghost" className="min-h-8 px-2 py-1" onClick={onGoTo}>Go to</Button>}
        {!onGoTo && !inBook && <Link to={annotationHref(a)} className="rounded-8 px-2 py-1 text-small text-green hover:bg-raised">Open in book</Link>}
        <Button variant="ghost" className="min-h-8 px-2 py-1" onClick={() => setConfirming(true)}>Delete</Button>
      </div>
      {(update.error ?? setTag.error) && <p className="text-small text-red">{(update.error ?? setTag.error)?.message}</p>}
      <ConfirmDialog
        open={confirming}
        title="Delete this note?"
        description={a.highlighted_text ? `The highlight “${a.highlighted_text.slice(0, 80)}” and its comment are removed.` : 'The note is removed.'}
        confirmLabel="Delete note"
        busy={del.isPending}
        error={del.error?.message}
        onConfirm={() => del.mutate(a.id, { onSuccess: onDeleted, onSettled: () => setConfirming(false) })}
        onClose={() => setConfirming(false)}
      />
    </article>
  );
}
