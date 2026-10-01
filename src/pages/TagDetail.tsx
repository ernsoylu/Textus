import { Link, useParams } from 'react-router-dom';
import { useTagItems } from '@/hooks/useTags';
import { useAnnotations } from '@/hooks/useAnnotations';
import { NoteCard } from '@/components/reader/NoteCard';

// FR-ORG-1: one tag across the library — the records, collections and notes it labels.
export function TagDetail() {
  const { tagId } = useParams<{ tagId: string }>();
  const { data, isLoading, error } = useTagItems(tagId);
  const annotations = useAnnotations();
  const notes = (annotations.data ?? []).filter((a) => a.annotation_tags.some((t) => t.tag_id === tagId));

  if (isLoading) return <p className="text-body text-muted">Loading…</p>;
  if (error || !data) return <p className="text-body text-red">This tag could not be found. <Link to="/tags" className="underline">Back to tags</Link></p>;

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6">
      <Link to="/tags" className="text-small text-muted underline">Tags</Link>
      <h1 className="flex items-center gap-3 font-serif text-title text-fg">
        <span aria-hidden="true" className="h-4 w-4 rounded-full" style={{ backgroundColor: data.tag.color ?? undefined }} />
        {data.tag.name}
      </h1>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-heading text-fg">Records · {data.records.length}</h2>
          {data.records.length > 0 && <Link to={`/library?tag=${data.tag.id}`} className="text-small text-green underline">Show in library</Link>}
        </div>
        {data.records.length === 0 && <p className="text-small text-muted">No records carry this tag. Add it from a work’s “Tags & collections”.</p>}
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.records.map((r) => (
            <li key={r.id}><Link to={`/library/${r.work_id}`} className="block truncate rounded-8 border border-border p-3 text-body text-fg hover:bg-raised">{r.title || r.works?.title || 'Untitled'}</Link></li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-heading text-fg">Collections · {data.collections.length}</h2>
        {data.collections.length === 0 && <p className="text-small text-muted">No collections carry this tag. Add it on a collection’s page.</p>}
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.collections.map((c) => (
            <li key={c.id}>
              <Link to={`/collections/${c.id}`} className="flex flex-col rounded-8 border border-border p-3 hover:bg-raised">
                <span className="text-body text-fg">{c.name}</span>
                {c.description && <span className="line-clamp-2 text-small text-muted">{c.description}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-heading text-fg">Notes · {notes.length}</h2>
          {notes.length > 0 && <Link to={`/notes?tag=${data.tag.id}`} className="text-small text-green underline">Open in Notes</Link>}
        </div>
        {annotations.isLoading && <p className="text-small text-muted">Loading…</p>}
        {!annotations.isLoading && notes.length === 0 && <p className="text-small text-muted">No notes carry this tag. Tag a note in the reader or on the Notes page.</p>}
        <div className="grid gap-3 lg:grid-cols-2">{notes.map((a) => <NoteCard key={a.id} a={a} showBook />)}</div>
      </section>
    </div>
  );
}
