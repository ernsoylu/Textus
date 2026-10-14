import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ANNOTATION_COLORS, ConflictError, annotationHref, bookTitle, highlightFill, isDrawing, isInk, noteLocation, useDeleteAnnotation, useSetAnnotationTag, useUpdateAnnotation, type AnnotationItem } from '@/hooks/useAnnotations';
import { TagPicker } from '@/components/library/TagPicker';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { UnsavedChangesGuard } from '@/components/ui/UnsavedChangesGuard';
import { Button } from '@/components/ui/button';
import { ColorSwatch } from './ColorSwatch';

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
  // The server revision this edit started from (FR-READ-12): a save never overwrites a newer one silently.
  const base = useRef({ note: a.note ?? '', at: a.updated_at });

  // Take a new server value only when nothing local is unsaved; otherwise keep the user's text.
  useEffect(() => {
    setNote((current) => {
      if (current.trim() !== base.current.note.trim()) return current;
      base.current = { note: a.note ?? '', at: a.updated_at };
      return a.note ?? '';
    });
  }, [a.note, a.updated_at]);

  const save = () =>
    dirty && update.mutate({ id: a.id, note: note.trim(), expected: base.current.at }, { onSuccess: () => (base.current = { note: note.trim(), at: null }) });

  return (
    <article className="flex flex-col gap-2 rounded-8 border border-border bg-surface p-3" style={{ borderLeft: `4px solid ${highlightFill(color)}` }}>
      <UnsavedChangesGuard dirty={dirty} subject="note" onSave={() => update.mutateAsync({ id: a.id, note: note.trim(), expected: base.current.at })} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showBook ? <Link to={`/library/${a.records?.work_id}`} className="min-w-0 truncate text-label text-fg hover:underline">{bookTitle(a)}</Link> : <span className="text-small text-muted">{where}</span>}
        {!isDrawing(a) && (
          <div className="flex" role="radiogroup" aria-label="Highlight color">
            {ANNOTATION_COLORS.map((c) => (
              <ColorSwatch key={c} role="radio" aria-checked={color === c} aria-label={c} selected={color === c} fill={highlightFill(c)} onClick={() => color !== c && update.mutate({ id: a.id, color: c })} />
            ))}
          </div>
        )}
      </div>
      {isDrawing(a) && <p className="text-small text-muted">Pen drawing{where ? ` on ${where.toLowerCase()}` : ''}.</p>}
      {isInk(a) && !isDrawing(a) && !a.highlighted_text && <p className="text-small text-muted">Freehand highlight{where ? ` on ${where.toLowerCase()}` : ''} (no text under it).</p>}
      {a.highlighted_text && <blockquote className="line-clamp-6 border-l-2 border-border pl-2 font-serif text-small italic text-muted">{a.highlighted_text}</blockquote>}
      <textarea
        aria-label="Comment"
        placeholder="Add a comment…"
        rows={note ? Math.min(8, note.split('\n').length + 1) : 2}
        value={note}
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
        {dirty && <Button variant="secondary" className="min-h-11 px-3 py-1" isLoading={update.isPending} onClick={save}>Save</Button>}
        {onGoTo && <Button variant="ghost" className="min-h-11 px-3 py-1" onClick={onGoTo}>Go to</Button>}
        {!onGoTo && !inBook && <Link to={annotationHref(a)} className="flex min-h-11 items-center rounded-8 px-3 text-small text-green hover:bg-raised">Open in book</Link>}
        <Button variant="ghost" className="min-h-11 px-3 py-1" onClick={() => setConfirming(true)}>Delete</Button>
      </div>
      {(update.error ?? setTag.error) && <p role="alert" className="text-small text-red">{(update.error ?? setTag.error)?.message}</p>}
      {update.error instanceof ConflictError && (
        <div className="flex flex-wrap gap-1">
          {a.note && <p className="w-full whitespace-pre-wrap rounded-4 bg-dim p-2 text-small text-fg">Saved elsewhere: {a.note}</p>}
          <Button variant="secondary" className="min-h-11 px-3" onClick={() => { base.current = { note: a.note ?? '', at: a.updated_at }; update.reset(); }}>Keep mine</Button>
          <Button variant="ghost" className="min-h-11 px-3" onClick={() => { base.current = { note: a.note ?? '', at: a.updated_at }; setNote(a.note ?? ''); update.reset(); }}>Use saved version</Button>
        </div>
      )}
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
