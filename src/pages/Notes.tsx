import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ANNOTATION_COLORS, annotationHref, highlightFill, useAnnotations } from '@/hooks/useAnnotations';
import { useTags } from '@/hooks/useTags';
import { annotationsToJson, annotationsToMarkdown, downloadText } from '@/lib/annotationExport';
import { filterNotes, groupNotes, NOTE_SORTS, type NoteSort } from '@/lib/noteFilters';
import { NoteCard } from '@/components/reader/NoteCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const SORT_LABELS: Record<NoteSort, string> = { newest: 'Newest first', oldest: 'Oldest first', page: 'Book, then page' };

// FR-READ-4/5, FR-ORG-1: every highlight and note in the library, grouped by book, searchable, filterable by
// tag, color and comment, editable in place, and exportable as shown. Filters live in the URL (shareable, and
// the tag page links here with ?tag=).
export function Notes() {
  const { data, isLoading, error } = useAnnotations();
  const tags = useTags();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => ({
    q: params.get('q') ?? '',
    tagId: params.get('tag') ?? '',
    color: params.get('color') ?? '',
    commentsOnly: params.get('comments') === '1',
    sort: (NOTE_SORTS as readonly string[]).includes(params.get('sort') ?? '') ? (params.get('sort') as NoteSort) : 'newest',
  }), [params]);
  const set = (key: string, value: string) =>
    setParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
      return p;
    }, { replace: true });

  const tagNames = useMemo(() => new Map((tags.data ?? []).map((t) => [t.id, t.name])), [tags.data]);
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of data ?? []) for (const t of a.annotation_tags) counts.set(t.tag_id, (counts.get(t.tag_id) ?? 0) + 1);
    return counts;
  }, [data]);
  const shown = useMemo(() => filterNotes(data ?? [], filters, tagNames), [data, filters, tagNames]);
  const groups = useMemo(() => groupNotes(shown, filters.sort), [shown, filters.sort]);
  const filtered = !!(filters.q || filters.tagId || filters.color || filters.commentsOnly);
  const usedTags = (tags.data ?? []).filter((t) => tagCounts.has(t.id));

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-serif text-title text-fg">Notes</h1>
          {data && <p className="text-small text-muted">{data.length} {data.length === 1 ? 'note' : 'notes'} in {new Set(data.map((a) => a.record_id)).size} {new Set(data.map((a) => a.record_id)).size === 1 ? 'book' : 'books'}</p>}
        </div>
        {shown.length > 0 && (
          <div className="flex gap-1">
            <Button variant="ghost" onClick={() => downloadText('notes.md', annotationsToMarkdown(shown), 'text/markdown')}>Export Markdown</Button>
            <Button variant="ghost" onClick={() => downloadText('notes.json', annotationsToJson(shown), 'application/json')}>Export JSON</Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-8 border border-border bg-dim p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[240px] flex-1">
            <Input type="search" aria-label="Search notes" placeholder="Search quotes, comments, books and tags…" value={filters.q} onChange={(e) => set('q', e.target.value)} />
          </div>
          <select aria-label="Sort notes" value={filters.sort} onChange={(e) => set('sort', e.target.value === 'newest' ? '' : e.target.value)} className="rounded-8 border border-muted bg-dim p-3 text-body text-fg">
            {NOTE_SORTS.map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-small text-muted">Tags</span>
          {usedTags.length === 0 && <span className="text-small text-muted">none yet — add tags to a note below or in the reader</span>}
          {usedTags.map((t) => {
            const on = filters.tagId === t.id;
            return (
              <button key={t.id} type="button" aria-pressed={on} onClick={() => set('tag', on ? '' : t.id)} style={{ borderColor: t.color ?? undefined, backgroundColor: on ? (t.color ?? undefined) : undefined }} className={`rounded-4 border px-2 py-0.5 text-small ${on ? 'text-dim' : 'text-fg'}`}>
                {t.name} <span className={on ? '' : 'text-muted'}>{tagCounts.get(t.id)}</span>
              </button>
            );
          })}
          <Link to="/tags" className="text-small text-green underline">Manage tags</Link>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-small text-muted">Color</span>
          {ANNOTATION_COLORS.map((c) => (
            <button key={c} type="button" aria-pressed={filters.color === c} aria-label={`Only ${c}`} onClick={() => set('color', filters.color === c ? '' : c)} style={{ backgroundColor: highlightFill(c) }} className={`h-5 w-5 rounded-full border ${filters.color === c ? 'border-fg ring-2 ring-fg' : 'border-transparent'}`} />
          ))}
          <label className="flex items-center gap-2 text-small text-fg">
            <input type="checkbox" checked={filters.commentsOnly} onChange={(e) => set('comments', e.target.checked ? '1' : '')} />
            With comments only
          </label>
          {filtered && <Button variant="ghost" className="min-h-8 px-2 py-1" onClick={() => setParams(filters.sort === 'newest' ? {} : { sort: filters.sort }, { replace: true })}>Clear filters</Button>}
          {filtered && data && <span className="text-small text-muted" aria-live="polite">{shown.length} of {data.length}</span>}
        </div>
      </div>

      {isLoading && <p className="text-body text-muted">Loading…</p>}
      {error && <p className="text-body text-red">Could not load notes: {error.message}</p>}
      {data?.length === 0 && <p className="text-body text-muted">No highlights or notes yet. While reading, select text and right-click to highlight it or add a comment.</p>}
      {data && data.length > 0 && shown.length === 0 && <p className="text-body text-muted">No notes match these filters.</p>}

      {groups.map((g) => (
        <details key={g.recordId} open className="group flex flex-col gap-2">
          <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-border pb-2">
            <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-90">›</span>
            <h2 className="min-w-0 truncate font-serif text-heading text-fg">{g.title}</h2>
            <span className="text-small text-muted">{g.items.length}</span>
            <span className="flex-1" />
            {g.workId && <Link to={`/library/${g.workId}`} className="text-small text-muted underline">Details</Link>}
            <Link to={annotationHref(g.items[0])} className="text-small text-green underline">Open book</Link>
          </summary>
          <div className="mt-2 grid gap-3 lg:grid-cols-2">{g.items.map((a) => <NoteCard key={a.id} a={a} />)}</div>
        </details>
      ))}
    </div>
  );
}
