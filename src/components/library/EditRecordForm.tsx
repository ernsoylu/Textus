import { useState } from 'react';
import { useUpdateRecord, useDeleteRecord } from '@/hooks/useCatalogMutations';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { UnsavedChangesGuard } from '@/components/ui/UnsavedChangesGuard';

export function EditRecordForm({
  workId,
  recordId,
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
  title: string | null;
  publisher: string | null;
  edition: string | null;
  volume: string | null;
  issueNumber: string | null;
  pages: string | null;
  publicationDate: string | null;
}>) {
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
  const patch = {
    title: title.trim() || null,
    publisher: publisher.trim() || null,
    edition: edition.trim() || null,
    volume: volume.trim() || null,
    issue_number: issueNumber.trim() || null,
    pages: pages.trim() || null,
    publication_date: publicationDate || null,
    publication_date_precision: publicationDate ? ('day' as const) : null,
  };
  const dirty =
    patch.title !== (initialTitle?.trim() || null) ||
    patch.publisher !== (initialPublisher?.trim() || null) ||
    patch.edition !== (initialEdition?.trim() || null) ||
    patch.volume !== (initialVolume?.trim() || null) ||
    patch.issue_number !== (initialIssueNumber?.trim() || null) ||
    patch.pages !== (initialPages?.trim() || null) ||
    patch.publication_date !== (initialPublicationDate || null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Record title (optional)" className="w-auto min-w-[200px]" />
        <Input value={publisher} onChange={(e) => setPublisher(e.target.value)} placeholder="Publisher" className="w-auto min-w-[160px]" />
        <Input value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="Edition" className="w-auto min-w-[100px]" />
        <Input value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="Volume" className="w-auto min-w-[80px]" />
        <Input value={issueNumber} onChange={(e) => setIssueNumber(e.target.value)} placeholder="Issue no." className="w-auto min-w-[80px]" />
        <Input value={pages} onChange={(e) => setPages(e.target.value)} placeholder="Pages" className="w-auto min-w-[80px]" />
        <Input aria-label="Publication date" type="date" value={publicationDate} onChange={(e) => setPublicationDate(e.target.value)} className="w-auto" />
      </div>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          isLoading={update.isPending}
          onClick={() => update.mutate({ recordId, patch })}
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
      <UnsavedChangesGuard dirty={dirty} subject="edition" onSave={() => update.mutateAsync({ recordId, patch })} />
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
