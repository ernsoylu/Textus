import { Link, useParams } from 'react-router-dom';
import { useWork } from '@/hooks/useWork';
import { AddIdentifierForm } from '@/components/library/AddIdentifierForm';
import { UploadForm } from '@/components/library/UploadForm';
import { EditWorkForm } from '@/components/library/EditWorkForm';
import { EditRecordForm } from '@/components/library/EditRecordForm';
import { ContributorEditor } from '@/components/metadata/ContributorEditor';
import { IdentifierList } from '@/components/library/IdentifierList';
import { FileList } from '@/components/library/FileList';
import { AddArticleVersionForm } from '@/components/library/AddArticleVersionForm';
import { AddIssueForm } from '@/components/library/AddIssueForm';
import { SerialCompleteness } from '@/components/library/SerialCompleteness';
import { readExpectedIssues } from '@/lib/serialCompleteness';
import { ContainerPicker } from '@/components/library/ContainerPicker';
import { ExportButton } from '@/components/library/ExportButton';
import { RecordOrganizer } from '@/components/library/RecordOrganizer';
import { MetadataLookup } from '@/components/metadata/MetadataLookup';

// "edition · 2019", "article_version · preprint", "issue · vol. 3 no. 2 · 2020".
function recordLabel(record: { record_type: string; metadata: unknown; volume: string | null; issue_number: string | null; publication_date: string | null }): string {
  const version = (record.metadata as { version?: unknown } | null)?.version;
  const issue = record.record_type === 'issue' ? [record.volume && `vol. ${record.volume}`, record.issue_number && `no. ${record.issue_number}`].filter(Boolean).join(' ') : '';
  const year = record.publication_date ? new Date(record.publication_date).getFullYear() : '';
  return [record.record_type, typeof version === 'string' ? version : '', issue, year].filter(Boolean).join(' · ');
}

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
          <SerialCompleteness issues={data.records.filter((r) => r.record_type === 'issue')} expected={readExpectedIssues(data.metadata)} />
          <Link to={`/serials/${data.id}`} className="text-small text-green underline">Open the serial view</Link>
          <AddIssueForm workId={data.id} />
        </div>
      )}
      {data.work_type === 'article' && <AddArticleVersionForm workId={data.id} />}

      {data.records.map((record) => (
        <div key={record.id} className="flex flex-col gap-2 rounded-8 border border-border p-4">
          <p className="text-label text-fg">
            {recordLabel(record)}
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

          <IdentifierList workId={data.id} recordId={record.id} identifiers={record.identifiers} />
          <AddIdentifierForm recordId={record.id} />
          <RecordOrganizer recordId={record.id} />
          <MetadataLookup work={data} record={record} />

          <ContributorEditor workId={data.id} recordId={record.id} existingCredits={record.record_contributors} />

          <FileList workId={data.id} recordId={record.id} files={record.record_assets} />
          <UploadForm recordId={record.id} />
        </div>
      ))}
    </div>
  );
}
