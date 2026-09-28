import { useParams } from 'react-router-dom';
import { useWork } from '@/hooks/useWork';
import { AddIdentifierForm } from '@/components/library/AddIdentifierForm';
import { UploadForm } from '@/components/library/UploadForm';
import { StatusBadge } from '@/components/library/StatusBadge';
import { EditWorkForm } from '@/components/library/EditWorkForm';
import { EditRecordForm } from '@/components/library/EditRecordForm';

// FR-CAT-1: full read/update/delete for works and records. No file reader, metadata
// lookup, or contributor editor yet — separate, not-yet-started slices of M1/M2.
export function WorkDetail() {
  const { workId } = useParams<{ workId: string }>();
  const { data, isLoading, error } = useWork(workId);

  if (isLoading) return <p className="text-body text-muted">Loading…</p>;
  if (error) return <p className="text-body text-red">Could not load this work: {error.message}</p>;
  if (!data) return null;

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <EditWorkForm workId={data.id} title={data.title} subtitle={data.subtitle} workType={data.work_type} />

      {data.records.map((record) => (
        <div key={record.id} className="flex flex-col gap-2 rounded-8 border border-border p-4">
          <p className="text-label text-fg">
            {record.record_type}
            {record.publication_date && ` · ${new Date(record.publication_date).getFullYear()}`}
          </p>
          {record.byline && <p className="text-small text-muted">{record.byline}</p>}

          <EditRecordForm
            workId={data.id}
            recordId={record.id}
            title={record.title}
            publisher={record.publisher}
            edition={record.edition}
            volume={record.volume}
            issueNumber={record.issue_number}
            pages={record.pages}
            publicationDate={record.publication_date}
          />

          {record.identifiers.map((id) => (
            <p key={`${id.scheme}:${id.normalized_value}`} className="text-small text-green">
              {id.scheme.toUpperCase()}: {id.normalized_value}
            </p>
          ))}
          <AddIdentifierForm recordId={record.id} />

          {record.record_assets.length > 0 && (
            <div className="flex flex-col gap-1 pt-2">
              {record.record_assets.map(({ role, assets: asset }) =>
                asset ? (
                  <div key={`${asset.id}:${role}`} className="flex items-center gap-2">
                    <StatusBadge state={asset.processing_state} />
                    <p className="text-small text-fg">
                      {role} · {asset.file_format} · {(asset.file_size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                ) : null,
              )}
            </div>
          )}
          <UploadForm recordId={record.id} />
        </div>
      ))}
    </div>
  );
}
