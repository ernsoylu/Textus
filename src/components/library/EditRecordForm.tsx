import { useEffect, useRef, useState } from 'react';
import { useUpdateRecord, useDeleteRecord } from '@/hooks/useCatalogMutations';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { UnsavedChangesGuard } from '@/components/ui/UnsavedChangesGuard';
import { RECORD_TYPES, RECORD_TYPE_LABELS } from '@/lib/recordTypes';
import { meta } from '@/lib/metadataApply';

export function EditRecordForm({
  workId,
  recordId,
  recordType: initialRecordType,
  metadata,
  title: initialTitle,
  publisher: initialPublisher,
  edition: initialEdition,
  volume: initialVolume,
  issueNumber: initialIssueNumber,
  pages: initialPages,
  publicationDate: initialPublicationDate,
}: Readonly<{
  workId: string;
  recordId: string;
  recordType: string;
  metadata?: unknown;
  title: string | null;
  publisher: string | null;
  edition: string | null;
  volume: string | null;
  issueNumber: string | null;
  pages: string | null;
  publicationDate: string | null;
}>) {
  const [recordType, setRecordType] = useState(initialRecordType);
  const initialExtras = Object.fromEntries(['container_title', 'version', 'degree'].map((key) => [key, typeof meta(metadata)[key] === 'string' ? meta(metadata)[key] as string : '']));
  const [extras, setExtras] = useState(initialExtras);
  const previousExtras = useRef(initialExtras);
  const extrasKey = JSON.stringify(initialExtras);
  useEffect(() => {
    const incoming = JSON.parse(extrasKey) as Record<string, string>;
    const previous = previousExtras.current;
    setExtras((current) => Object.fromEntries(Object.entries(incoming).map(([key, value]) => [key, current[key] === previous[key] ? value : current[key]])));
    previousExtras.current = incoming;
  }, [extrasKey]);
  useEffect(() => setRecordType(initialRecordType), [initialRecordType]);
  const article = recordType === 'article_version';
  const chapter = recordType === 'chapter';
  const issue = recordType === 'issue';
  const editionRecord = recordType === 'edition';
  const other = recordType === 'other';
  const showEdition = editionRecord || recordType === 'standard' || recordType === 'report' || other;
  const showVolume = editionRecord || article || issue || other;
  const showIssue = article || issue || other;
  const publisherLabel = recordType === 'thesis' ? 'University' : recordType === 'report' ? 'Issuing institution' : recordType === 'standard' ? 'Standards body' : 'Publisher';
  const editionLabel = recordType === 'standard' ? 'Revision' : 'Edition';
  const extraFields = article ? [['container_title', 'Journal'], ['version', 'Version']] : chapter ? [['container_title', 'Book / proceedings']] : recordType === 'thesis' ? [['degree', 'Degree']] : [];
  const metadataPatch = Object.fromEntries(extraFields.filter(([key]) => extras[key] !== initialExtras[key]).map(([key]) => [key, extras[key].trim() || null]));
  const [title, setTitle] = useState(initialTitle ?? '');
  const [publisher, setPublisher] = useState(initialPublisher ?? '');
  const [edition, setEdition] = useState(initialEdition ?? '');
  const [volume, setVolume] = useState(initialVolume ?? '');
  const [issueNumber, setIssueNumber] = useState(initialIssueNumber ?? '');
  const [pages, setPages] = useState(initialPages ?? '');
  const [publicationDate, setPublicationDate] = useState(initialPublicationDate ?? '');
  const update = useUpdateRecord(workId);
  const remove = useDeleteRecord(workId);
  const [confirming, setConfirming] = useState(false);
  const previous = useRef({ title: initialTitle ?? '', publisher: initialPublisher ?? '', edition: initialEdition ?? '', volume: initialVolume ?? '', issueNumber: initialIssueNumber ?? '', pages: initialPages ?? '', publicationDate: initialPublicationDate ?? '' });
  const patch = {
    record_type: recordType,
    title: title.trim() || null,
    publisher: publisher.trim() || null,
    ...(showEdition ? { edition: edition.trim() || null } : {}),
    ...(showVolume ? { volume: volume.trim() || null } : {}),
    ...(showIssue ? { issue_number: issueNumber.trim() || null } : {}),
    pages: pages.trim() || null,
    publication_date: publicationDate || null,
    publication_date_precision: publicationDate ? ('day' as const) : null,
  };
  const dirty = recordType !== initialRecordType || Object.keys(metadataPatch).length > 0 ||
    patch.title !== (initialTitle?.trim() || null) ||
    patch.publisher !== (initialPublisher?.trim() || null) ||
    (showEdition && patch.edition !== (initialEdition?.trim() || null)) ||
    (showVolume && patch.volume !== (initialVolume?.trim() || null)) ||
    (showIssue && patch.issue_number !== (initialIssueNumber?.trim() || null)) ||
    patch.pages !== (initialPages?.trim() || null) ||
    patch.publication_date !== (initialPublicationDate || null);

  useEffect(() => {
    if (title === previous.current.title) setTitle(initialTitle ?? '');
    if (publisher === previous.current.publisher) setPublisher(initialPublisher ?? '');
    if (edition === previous.current.edition) setEdition(initialEdition ?? '');
    if (volume === previous.current.volume) setVolume(initialVolume ?? '');
    if (issueNumber === previous.current.issueNumber) setIssueNumber(initialIssueNumber ?? '');
    if (pages === previous.current.pages) setPages(initialPages ?? '');
    if (publicationDate === previous.current.publicationDate) setPublicationDate(initialPublicationDate ?? '');
    previous.current = { title: initialTitle ?? '', publisher: initialPublisher ?? '', edition: initialEdition ?? '', volume: initialVolume ?? '', issueNumber: initialIssueNumber ?? '', pages: initialPages ?? '', publicationDate: initialPublicationDate ?? '' };
  }, [initialTitle, initialPublisher, initialEdition, initialVolume, initialIssueNumber, initialPages, initialPublicationDate]);

  return (
    <div className="flex flex-col gap-2">
      <label className="text-small text-muted">Record type
        <select aria-label="Record type" className="block w-full rounded-8 border border-muted bg-dim p-3 text-body text-fg" value={recordType} onChange={(e) => setRecordType(e.target.value)}>
          {RECORD_TYPES.map((type) => <option key={type} value={type}>{RECORD_TYPE_LABELS[type]}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {[
          { label: 'Record title (optional)', value: title, set: setTitle, show: true },
          { label: publisherLabel, value: publisher, set: setPublisher, show: true },
          { label: editionLabel, value: edition, set: setEdition, show: showEdition },
          { label: 'Volume', value: volume, set: setVolume, show: showVolume },
          { label: 'Issue no.', value: issueNumber, set: setIssueNumber, show: showIssue },
          { label: article ? 'Pages / article number' : 'Pages', value: pages, set: setPages, show: true },
        ].filter((field) => field.show).map((field) => (
          <label key={field.label} className="min-w-0 text-small text-muted">{field.label}
            <Input value={field.value} onChange={(e) => field.set(e.target.value)} placeholder={field.label} />
          </label>
        ))}
        {extraFields.map(([key, label]) => (
          <label key={key} className="min-w-0 text-small text-muted">{label}
            {key === 'version' ? (
              <select aria-label={label} className="block w-full rounded-8 border border-muted bg-dim p-4 text-body text-fg" value={extras[key]} onChange={(e) => setExtras({ ...extras, [key]: e.target.value })}>
                <option value="">Unspecified</option>
                <option value="preprint">Preprint</option>
                <option value="accepted">Accepted manuscript</option>
                <option value="published">Published version</option>
                {extras[key] && !['preprint', 'accepted', 'published'].includes(extras[key]) && <option value={extras[key]}>{extras[key]}</option>}
              </select>
            ) : <Input value={extras[key]} onChange={(e) => setExtras({ ...extras, [key]: e.target.value })} placeholder={label} />}
          </label>
        ))}
        <label className="text-small text-muted">Publication date
          <Input aria-label="Publication date" type="date" value={publicationDate} onChange={(e) => setPublicationDate(e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          isLoading={update.isPending}
          onClick={() => update.mutate({ recordId, patch, metadataPatch })}
        >
          Save
        </Button>
        <Button
          variant="danger"
          onClick={() => setConfirming(true)}
        >
          Delete record
        </Button>
      </div>
      <UnsavedChangesGuard dirty={dirty} subject="record" onSave={() => update.mutateAsync({ recordId, patch, metadataPatch })} />
      <ConfirmDialog
        open={confirming}
        title="Delete this record?"
        description="This removes the record with its identifiers, credits and file links. Files no other record uses are deleted from storage within a day. This cannot be undone."
        confirmLabel="Delete record"
        busy={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => remove.mutate(recordId, { onSettled: () => setConfirming(false) })}
        onClose={() => setConfirming(false)}
      />
      {update.isError && <p className="text-small text-red">{update.error.message}</p>}
    </div>
  );
}
