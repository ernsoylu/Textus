import { useParams, Link } from 'react-router-dom';
import { useWork } from '@/hooks/useWork';
import { AddIdentifierForm } from '@/components/library/AddIdentifierForm';
import { UploadForm } from '@/components/library/UploadForm';
import { StatusBadge } from '@/components/library/StatusBadge';
import { EditWorkForm } from '@/components/library/EditWorkForm';
import { EditRecordForm } from '@/components/library/EditRecordForm';
import { ContributorEditor } from '@/components/metadata/ContributorEditor';
import { DownloadButton } from '@/components/library/DownloadButton';
import { AddArticleVersionForm } from '@/components/library/AddArticleVersionForm';
import { AddIssueForm } from '@/components/library/AddIssueForm';
import { SerialCompleteness } from '@/components/library/SerialCompleteness';
import { ContainerPicker } from '@/components/library/ContainerPicker';
import { ExportButton } from '@/components/library/ExportButton';
import { RecordOrganizer } from '@/components/library/RecordOrganizer';
import { MetadataLookup } from '@/components/metadata/MetadataLookup';

// FR-CAT-1 and M2: catalog editing, identifier lookup, and contributor identity editing.
export function WorkDetail() {
  const { workId } = useParams<{ workId: string }>();
  const { data, isLoading, error } = useWork(workId);

  if (isLoading) return <p className="text-body text-muted">Loading…</p>;
  if (error) return <p className="text-body text-red">Could not load this work: {error.message}</p>;
  if (!data) return null;

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <EditWorkForm workId={data.id} title={data.title} subtitle={data.subtitle} abstract={data.abstract} language={data.language} workType={data.work_type} />

      <ExportButton recordIds={data.records.map((r) => r.id)} />

      {data.work_type === 'serial' && (
        <div className="flex flex-col gap-2 rounded-8 border border-border p-4">
          <p className="text-label text-fg">Issues</p>
          <SerialCompleteness issues={data.records.filter((r) => r.record_type === 'issue')} />
          <AddIssueForm workId={data.id} />
        </div>
      )}
      {data.work_type === 'article' && <AddArticleVersionForm workId={data.id} />}

      {data.records.map((record) => (
        <div key={record.id} className="flex flex-col gap-2 rounded-8 border border-border p-4">
          <p className="text-label text-fg">
            {record.record_type}
            {typeof (record.metadata as { version?: unknown } | null)?.version === 'string' && ` · ${(record.metadata as { version: string }).version}`}
            {record.record_type === 'issue' && (record.volume || record.issue_number) && ` · ${[record.volume && `vol. ${record.volume}`, record.issue_number && `no. ${record.issue_number}`].filter(Boolean).join(' ')}`}
            {record.publication_date && ` · ${new Date(record.publication_date).getFullYear()}`}
          </p>
          {record.byline && <p className="text-small text-muted">{record.byline}</p>}
          {record.metadata_source && <p className="text-small text-muted">Metadata from {record.metadata_source}{record.metadata_fetched_at ? ` · fetched ${new Date(record.metadata_fetched_at).toLocaleDateString()}` : ''}</p>}

          {(record.record_type === 'chapter' || record.record_type === 'article_version') && (
            <ContainerPicker workId={data.id} recordId={record.id} containerId={record.container_record_id} />
          )}

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
          <RecordOrganizer recordId={record.id} />
          <MetadataLookup work={data} record={record} />

          <ContributorEditor workId={data.id} recordId={record.id} existingCredits={record.record_contributors} />

          {record.record_assets.length > 0 && (
            <div className="flex flex-col gap-1 pt-2">
              {record.record_assets.map(({ role, assets: asset }) =>
                asset ? (
                  <div key={`${asset.id}:${role}`} className="flex items-center gap-2">
                    <StatusBadge state={asset.processing_state} />
                    <p className="text-small text-fg">
                      {role} · {asset.file_format} · {(asset.file_size / 1024).toFixed(0)} KB
                    </p>
                    {(asset.file_format === 'pdf' || asset.file_format === 'epub') ? (
                      <Link to={`/library/${data.id}/records/${record.id}/assets/${asset.id}/read`} className="text-small text-green underline">
                        Read
                      </Link>
                    ) : (
                      <DownloadButton bucket={asset.bucket} storagePath={asset.storage_path} />
                    )}
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
