import { useParams } from 'react-router-dom';
import { useWork } from '@/hooks/useWork';
import { AddIdentifierForm } from '@/components/library/AddIdentifierForm';

// Minimal read-only detail view. No file upload, identifier editing, metadata lookup,
// or contributor editor yet — those are separate, not-yet-started slices of M1/M2.
export function WorkDetail() {
  const { workId } = useParams<{ workId: string }>();
  const { data, isLoading, error } = useWork(workId);

  if (isLoading) return <p className="text-body text-muted">Loading…</p>;
  if (error) return <p className="text-body text-red">Could not load this work: {error.message}</p>;
  if (!data) return null;

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div>
        <p className="text-heading text-fg">{data.title}</p>
        {data.subtitle && <p className="text-body text-muted">{data.subtitle}</p>}
      </div>
      {data.records.map((record) => (
        <div key={record.id} className="flex flex-col gap-1 rounded-8 border border-border p-4">
          <p className="text-label text-fg">
            {record.record_type}
            {record.publication_date && ` · ${new Date(record.publication_date).getFullYear()}`}
          </p>
          {record.byline && <p className="text-small text-muted">{record.byline}</p>}
          {record.publisher && <p className="text-small text-muted">{record.publisher}</p>}
          {record.identifiers.map((id) => (
            <p key={`${id.scheme}:${id.normalized_value}`} className="text-small text-green">
              {id.scheme.toUpperCase()}: {id.normalized_value}
            </p>
          ))}
          <AddIdentifierForm recordId={record.id} />
        </div>
      ))}
    </div>
  );
}
