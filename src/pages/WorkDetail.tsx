import { lazy, Suspense } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
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
import { AutoMetadataImport } from '@/components/metadata/AutoMetadataImport';
import { defaultIdentifierScheme, RECORD_TYPES, RECORD_TYPE_LABELS, WORK_TYPE_LABELS, type WorkType } from '@/lib/recordTypes';
import { meta } from '@/lib/metadataApply';
import { useMetadataJobs } from '@/hooks/useJobs';
import { MetadataProgress } from '@/components/metadata/MetadataProgress';

const PdfViewer = lazy(() => import('@/components/reader/PdfViewer').then((module) => ({ default: module.PdfViewer })));
const EpubViewer = lazy(() => import('@/components/reader/EpubViewer').then((module) => ({ default: module.EpubViewer })));

// "edition · 2019", "article_version · preprint", "issue · vol. 3 no. 2 · 2020".
function recordLabel(record: { record_type: string; metadata: unknown; volume: string | null; issue_number: string | null; publication_date: string | null }): string {
  const version = (record.metadata as { version?: unknown } | null)?.version;
  const issue = record.record_type === 'issue' ? [record.volume && `vol. ${record.volume}`, record.issue_number && `no. ${record.issue_number}`].filter(Boolean).join(' ') : '';
  const year = record.publication_date ? new Date(record.publication_date).getFullYear() : '';
  return [RECORD_TYPE_LABELS[record.record_type as (typeof RECORD_TYPES)[number]] ?? record.record_type, typeof version === 'string' ? version : '', issue, year].filter(Boolean).join(' · ');
}

function hasLookupSuggestions(value: unknown) {
  const suggestions = meta(value).lookup_suggestions;
  return !!suggestions && typeof suggestions === 'object' && Object.keys(suggestions).length > 0;
}

// FR-CAT-1 and M2: catalog editing, identifier lookup, and contributor identity editing.
export function WorkDetail() {
  const { workId } = useParams<{ workId: string }>();
  const [params] = useSearchParams();
  const autoImport = params.get('autofill') === '1';
  const { data, isLoading, error } = useWork(workId);
  const metadataJobs = useMetadataJobs(data?.records.map((record) => record.id) ?? []);

  if (isLoading) return <p className="text-body text-muted">Loading…</p>;
  if (error) return <p className="text-body text-red">Could not load this work: {error.message}</p>;
  if (!data) return null;
  const preview = data.records.flatMap((record) => record.record_assets.flatMap(({ assets }) => assets && (assets.file_format === 'pdf' || assets.file_format === 'epub') ? [{ asset: assets, recordId: record.id }] : []))[0];

  return (
    <div className={preview ? 'max-w-none' : 'max-w-[640px]'}>
      <div className={preview ? 'grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(400px,640px)_minmax(480px,1fr)]' : 'flex flex-col gap-6'}>
      <div className="flex min-w-0 flex-col gap-6">
      {data.records.map((record) => (autoImport || hasLookupSuggestions(record.metadata)) && <AutoMetadataImport key={`auto-${record.id}`} work={data} record={record} enabled />)}
      <EditWorkForm workId={data.id} title={data.title} subtitle={data.subtitle} abstract={data.abstract} language={data.language} workType={data.work_type} userRating={data.user_rating} />

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
          <MetadataProgress message={metadataJobs.data?.[record.id]} />
          {record.metadata_source && <p className="text-small text-muted">Metadata from {record.metadata_source}{record.metadata_fetched_at ? ` · fetched ${new Date(record.metadata_fetched_at).toLocaleDateString()}` : ''}</p>}
          {typeof meta(record.metadata).standard_status === 'string' && <p className="text-small text-muted">Status: {String(meta(record.metadata).standard_status)}</p>}
          {typeof meta(record.metadata).source_url === 'string' && String(meta(record.metadata).source_url).startsWith('https://') && <a className="text-small text-green underline" href={String(meta(record.metadata).source_url)} target="_blank" rel="noreferrer">Source catalogue</a>}

          {(record.record_type === 'chapter' || record.record_type === 'article_version') && (
            <ContainerPicker workId={data.id} recordId={record.id} containerId={record.container_record_id} />
          )}

          <EditRecordForm
            workId={data.id}
            recordId={record.id}
            recordType={record.record_type}
            metadata={record.metadata}
            title={record.title}
            publisher={record.publisher}
            edition={record.edition}
            volume={record.volume}
            issueNumber={record.issue_number}
            pages={record.pages}
            publicationDate={record.publication_date}
          />

          <IdentifierList workId={data.id} recordId={record.id} identifiers={record.identifiers} />
          <AddIdentifierForm recordId={record.id} defaultScheme={defaultIdentifierScheme(record.record_type)} />
          <RecordOrganizer recordId={record.id} />
          <MetadataLookup work={data} record={record} defaultScheme={defaultIdentifierScheme(record.record_type)} />

          <ContributorEditor workId={data.id} recordId={record.id} existingCredits={record.record_contributors} />

          <FileList workId={data.id} recordId={record.id} files={record.record_assets} />
          <UploadForm recordId={record.id} />
        </div>
      ))}
      </div>
      {preview && (
        <aside className="min-w-0 xl:sticky xl:top-4">
          <p className="text-label text-fg">{WORK_TYPE_LABELS[data.work_type as WorkType] ?? 'Document'} preview</p>
          <p className="mb-2 text-small text-muted">Select and copy an ISBN, DOI or other identifier from the document, then paste it into Look up metadata.</p>
          <div className="max-h-[calc(100vh-170px)] overflow-auto rounded-8 border border-border">
            <Suspense fallback={<p className="p-4 text-small text-muted">Loading reader…</p>}>
              {preview.asset.file_format === 'pdf' ? <PdfViewer bucket="documents" storagePath={preview.asset.storage_path} /> : <EpubViewer storagePath={preview.asset.storage_path} highlights={[]} onProgress={() => undefined} onSelect={() => undefined} />}
            </Suspense>
          </div>
        </aside>
      )}
      </div>
    </div>
  );
}
