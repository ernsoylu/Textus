import { lazy, Suspense, useState } from 'react';
import { Link, useParams, useSearchParams, useMatch } from 'react-router-dom';
import { useWork } from '@/hooks/useWork';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { StarRating } from '@/components/library/StarRating';
import { Button } from '@/components/ui/button';
import { UploadForm } from '@/components/library/UploadForm';
import { DuplicateNotice } from '@/components/library/DuplicateNotice';
import { DeleteWorkButton } from '@/components/library/DeleteWorkButton';
import { EditWorkForm } from '@/components/library/EditWorkForm';
import { EditRecordForm } from '@/components/library/EditRecordForm';
import { ContributorEditor } from '@/components/metadata/ContributorEditor';
import { IdentifierList } from '@/components/library/IdentifierList';
import { DownloadButton } from '@/components/library/DownloadButton';
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
import { isBookFormat, isViewable } from '@/lib/formats';
import { useMetadataJobs } from '@/hooks/useJobs';
import { MetadataProgress } from '@/components/metadata/MetadataProgress';

const PdfViewer = lazy(() => import('@/components/reader/PdfViewer').then((module) => ({ default: module.PdfViewer })));
const BookViewer = lazy(() => import('@/components/reader/BookViewer').then((module) => ({ default: module.BookViewer })));
const DjvuViewer = lazy(() => import('@/components/reader/DjvuViewer').then((module) => ({ default: module.DjvuViewer })));

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

// The library opens details; /edit keeps catalog mutations separate from reading.
export function WorkDetail() {
  const { workId } = useParams<{ workId: string }>();
  const [params] = useSearchParams();
  const editing = !!useMatch('/library/:workId/edit');
  const [gathering, setGathering] = useState(false);
  const autoImport = params.get('autofill') === '1';
  const { data, isLoading, error } = useWork(workId);
  const metadataJobs = useMetadataJobs(data?.records.map((record) => record.id) ?? []);

  const cover = data?.records.flatMap((record) => record.record_assets).find(({ role, assets }) => role === 'cover' && assets?.bucket === 'covers')?.assets;
  const covers = useCoverUrls(cover ? [cover.storage_path] : []);

  if (isLoading) return <p className="text-body text-muted">Loading…</p>;
  if (error) return <p className="text-body text-red">Could not load this work: {error.message}</p>;
  if (!data) return null;
  const preview = data.records.flatMap((record) => record.record_assets.flatMap(({ role, assets }) => role !== 'cover' && assets?.bucket === 'documents' && isViewable(assets.file_format) ? [{ asset: assets, recordId: record.id }] : []))[0];

  const kind = (WORK_TYPE_LABELS[data.work_type as WorkType] ?? 'Work').toLowerCase();
  const readerPath = preview ? `/library/${data.id}/records/${preview.recordId}/assets/${preview.asset.id}/read` : null;

  if (!editing) return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6">
      <Link to="/library" className="text-small text-muted underline">Back to library</Link>
      {data.records.map((record) => (autoImport || hasLookupSuggestions(record.metadata)) && <AutoMetadataImport key={record.id} work={data} record={record} enabled />)}
      <DuplicateNotice workId={data.id} />
      <section className="grid items-start gap-6 rounded-8 border border-border bg-dim p-6 sm:grid-cols-[220px_minmax(0,1fr)]">
        {cover && covers.data?.get(cover.storage_path) ? <img src={covers.data.get(cover.storage_path)} alt={`Cover of ${data.title}`} className="mx-auto max-h-[330px] w-full max-w-[220px] rounded-8 object-contain shadow-lg" /> : <div className="mx-auto flex aspect-[2/3] w-full max-w-[220px] flex-col justify-between rounded-8 bg-green-bg p-6 shadow-lg"><span className="text-small text-fg">TEXTUS / LIBRARY</span><p className="line-clamp-6 break-words font-serif text-heading text-fg">{data.title}</p><p className="line-clamp-3 text-small text-fg">{data.records[0]?.byline || 'Unattributed'}</p></div>}
        <div className="flex min-w-0 flex-col gap-4">
          <p className="text-small uppercase tracking-widest text-green">{kind}</p>
          <h1 className="break-words font-serif text-[28px] leading-tight text-fg sm:text-[36px]">{data.title}</h1>
          {data.subtitle && <p className="text-heading text-muted">{data.subtitle}</p>}
          <p className="text-body text-fg">{data.records[0]?.byline || 'Unattributed'}</p>
          <div className="flex flex-wrap gap-2">
            {readerPath ? <Link to={readerPath} className="rounded-8 bg-green px-4 py-3 text-label text-dim">Read</Link> : <Button disabled>Read</Button>}
            <Link to={`/library/${data.id}/edit`} className="rounded-8 bg-raised px-4 py-3 text-label text-fg">Edit</Link>
            <Button variant="secondary" aria-expanded={gathering} aria-controls="book-metadata" onClick={() => setGathering(!gathering)}>Gather metadata</Button>
            <DeleteWorkButton workId={data.id} title={data.title} kind={kind} />
          </div>
          {!readerPath && <p className="text-small text-muted">Add a PDF, EPUB, MOBI, AZW3, CBZ or DjVu file in Edit to read here.</p>}
          <dl className="grid grid-cols-2 gap-4 text-small"><div><dt className="text-muted">Language</dt><dd className="text-fg">{data.language || 'Not specified'}</dd></div><div><dt className="text-muted">Your rating</dt><dd className="text-yellow"><StarRating value={data.user_rating} /></dd></div></dl>
        </div>
      </section>
      {gathering && <section id="book-metadata" className="flex flex-col gap-4">{data.records.map((record) => <MetadataLookup key={record.id} work={data} record={record} defaultScheme={defaultIdentifierScheme(record.record_type)} />)}{!data.records.length && <p className="text-small text-muted">Add a record in Edit to look up metadata.</p>}</section>}
      <section className="rounded-8 border border-border p-6"><h2 className="mb-3 text-heading text-fg">Description</h2><p className="whitespace-pre-wrap break-words text-body text-muted">{data.abstract || 'No description yet.'}</p></section>
      {data.work_type === 'serial' && <Link to={`/serials/${data.id}`} className="text-small text-green underline">Open the serial view</Link>}
      {data.records.map((record) => <section key={record.id} className="flex flex-col gap-4 rounded-8 border border-border p-6">
        <h2 className="text-heading text-fg">{recordLabel(record)}</h2>
        {record.byline && <p className="text-body text-muted">{record.byline}</p>}
        <MetadataProgress message={metadataJobs.data?.[record.id]} />
        <dl className="grid gap-4 text-small sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries({ Title: record.title, Publisher: record.publisher, Edition: record.edition, 'Publication date': record.publication_date, Volume: record.volume, Issue: record.issue_number, Pages: record.pages, Journal: meta(record.metadata).container_title, Version: meta(record.metadata).version, Degree: meta(record.metadata).degree, Status: meta(record.metadata).standard_status, 'Metadata source': record.metadata_source, 'Metadata fetched': record.metadata_fetched_at, ...Object.fromEntries(record.identifiers.map((id) => [id.scheme.toUpperCase(), record.identifiers.filter((other) => other.scheme === id.scheme).map((other) => other.normalized_value).join(' · ')])) }).filter(([, value]) => value).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-muted">{label}</dt><dd className="break-words text-fg">{String(value)}</dd></div>)}
        </dl>
        {record.container_record_id && <Link to={`/library/${data.id}/edit`} className="text-small text-green underline">View or edit linked container</Link>}
        {typeof meta(record.metadata).source_url === 'string' && String(meta(record.metadata).source_url).startsWith('https://') && <a href={String(meta(record.metadata).source_url)} target="_blank" rel="noreferrer" className="text-small text-green underline">Source catalogue</a>}
        <h3 className="text-label text-fg">Files</h3>
        {record.record_assets.filter(({ role }) => role !== 'cover').map(({ role, assets }) => assets && <div key={`${assets.id}:${role}`} className="flex flex-wrap items-center gap-3 text-small text-muted"><span>{role} · {assets.file_format.toUpperCase()}</span>{isViewable(assets.file_format) ? <Link to={`/library/${data.id}/records/${record.id}/assets/${assets.id}/read`} className="text-green underline">Read {assets.file_format.toUpperCase()}</Link> : <DownloadButton bucket={assets.bucket} storagePath={assets.storage_path} />}</div>)}
        <div className="border-t border-border pt-4"><h3 className="mb-3 text-label text-fg">Tags & collections</h3><RecordOrganizer recordId={record.id} /></div>
      </section>)}
      <ExportButton recordIds={data.records.map((record) => record.id)} />
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
      <Link to={`/library/${data.id}`} className="text-small text-muted underline">Back to details</Link>
      <div className={preview ? 'grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,720px)_minmax(0,1fr)]' : 'flex max-w-[720px] flex-col gap-6'}>
      <div className="flex min-w-0 flex-col gap-6">
      {data.records.map((record) => (autoImport || hasLookupSuggestions(record.metadata)) && <AutoMetadataImport key={`auto-${record.id}`} work={data} record={record} enabled />)}
      <EditWorkForm workId={data.id} title={data.title} subtitle={data.subtitle} abstract={data.abstract} language={data.language} workType={data.work_type} userRating={data.user_rating}>
        {data.records.map((record) => <section key={record.id} className="my-4 flex flex-col gap-3 border-y border-border py-4"><h2 className="text-label text-fg">Authors & contributors · {recordLabel(record)}</h2><ContributorEditor workId={data.id} recordId={record.id} existingCredits={record.record_contributors} /></section>)}
      </EditWorkForm>

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
          <MetadataLookup work={data} record={record} defaultScheme={defaultIdentifierScheme(record.record_type)} />
          <details><summary className="cursor-pointer text-label text-fg">Tags & collections</summary><RecordOrganizer recordId={record.id} /></details>

          <FileList workId={data.id} recordId={record.id} files={record.record_assets} />
          <UploadForm recordId={record.id} />
        </div>
      ))}
      </div>
      {preview && (
        <aside className="min-w-0 xl:sticky xl:top-4">
          <p className="text-label text-fg">{WORK_TYPE_LABELS[data.work_type as WorkType] ?? 'Document'} preview</p>
          <p className="mb-2 text-small text-muted">Select and copy an ISBN, DOI or other identifier from the document, then paste it into Look up metadata.</p>
          <div className="h-[calc(100vh-170px)] overflow-hidden rounded-8 border border-border p-2">
            <Suspense fallback={<p className="p-4 text-small text-muted">Loading reader…</p>}>
              {preview.asset.file_format === 'pdf' && <PdfViewer storagePath={preview.asset.storage_path} annotations={[]} />}
              {preview.asset.file_format === 'djvu' && <DjvuViewer storagePath={preview.asset.storage_path} annotations={[]} />}
              {isBookFormat(preview.asset.file_format) && <BookViewer storagePath={preview.asset.storage_path} format={preview.asset.file_format} annotations={[]} />}
            </Suspense>
          </div>
        </aside>
      )}
      </div>
    </div>
  );
}
