import { useAnnotations } from '@/hooks/useAnnotations';
import { AnnotationPanel } from '@/components/reader/AnnotationPanel';

// FR-READ-4/5: every annotation across the library, with Markdown/JSON export.
export function Notes() {
  const { data, isLoading, error } = useAnnotations();
  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      <p className="text-heading text-fg">Notes</p>
      {isLoading && <p className="text-body text-muted">Loading…</p>}
      {error && <p className="text-body text-red">Could not load notes: {error.message}</p>}
      {data?.length === 0 && <p className="text-body text-muted">No highlights or notes yet. Add them while reading.</p>}
      {data && data.length > 0 && <AnnotationPanel items={data} />}
    </div>
  );
}
