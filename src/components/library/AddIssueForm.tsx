import { useState, type FormEvent } from 'react';
import { useAddRecord } from '@/hooks/useCatalogMutations';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

// FR-SER-1: an issue is a record (record_type 'issue') of a serial work.
export function AddIssueForm({ workId }: { workId: string }) {
  const add = useAddRecord(workId);
  const [volume, setVolume] = useState('');
  const [issue, setIssue] = useState('');
  const [date, setDate] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    add.mutate(
      {
        record_type: 'issue',
        volume: volume.trim() || undefined,
        issue_number: issue.trim() || undefined,
        publication_date: date || undefined,
        publication_date_precision: date ? 'day' : undefined,
      },
      { onSuccess: () => setIssue('') },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-start gap-2">
      <Input placeholder="Volume" value={volume} onChange={(e) => setVolume(e.target.value)} className="w-[110px]" />
      <Input placeholder="Issue no." value={issue} onChange={(e) => setIssue(e.target.value)} className="w-[110px]" />
      <input type="date" aria-label="Publication date" className="rounded-8 border border-muted bg-dim p-4 text-body text-fg" value={date} onChange={(e) => setDate(e.target.value)} />
      <Button type="submit" variant="secondary" isLoading={add.isPending} disabled={!volume.trim() && !issue.trim()}>Add issue</Button>
      {add.error && <p className="w-full text-small text-red">{add.error.message}</p>}
    </form>
  );
}
