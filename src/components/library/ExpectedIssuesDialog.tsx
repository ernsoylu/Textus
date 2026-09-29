import { useState } from 'react';
import { useSetExpectedIssues } from '@/hooks/useSerials';
import { parseIssueRanges } from '@/lib/issueRanges';
import { ModalDialog } from '@/components/ui/ModalDialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { ExpectedIssues } from '@/lib/serialCompleteness';

// Figma "expected issues": "Define the run you collect." — completeness compares held issues with this run.
export function ExpectedIssuesDialog({ workId, expected, initialVolume, open, onClose }: Readonly<{ workId: string; expected: ExpectedIssues; initialVolume: string; open: boolean; onClose: () => void }>) {
  const save = useSetExpectedIssues(workId);
  const [volume, setVolume] = useState(initialVolume);
  const [run, setRun] = useState(expected[initialVolume] ?? '');
  const [error, setError] = useState<string | null>(null);

  function pickVolume(v: string) {
    setVolume(v);
    setRun(expected[v.trim()] ?? '');
  }

  function submit() {
    const parsed = parseIssueRanges(run);
    if (!parsed.ok) return setError(parsed.message);
    setError(null);
    save.mutate({ volume, run }, { onSuccess: onClose });
  }

  return (
    <ModalDialog open={open} title="Define the run you collect." onClose={onClose} onOpen={() => { setVolume(initialVolume); setRun(expected[initialVolume] ?? ''); setError(null); }}>
      <p className="text-body text-muted">Completeness compares owned issues with the range you track.</p>
      <label className="flex flex-col gap-2 text-small text-fg">
        Year / volume
        <Input value={volume} onChange={(e) => pickVolume(e.target.value)} placeholder="2024" />
      </label>
      <label className="flex flex-col gap-2 text-small text-fg">
        Expected issue numbers
        <Input value={run} onChange={(e) => setRun(e.target.value)} placeholder="1-12" error={error ?? undefined} />
      </label>
      <p className="text-small text-muted">Irregular publication? Enter issue numbers individually, like 1-6, 8, 10-12. Missing means absent from this tracked run. Leave empty to stop tracking a run.</p>
      {save.error && <p className="text-small text-red" role="alert">{save.error.message}</p>}
      <div className="flex gap-2">
        <Button isLoading={save.isPending} onClick={submit}>Save expected issues</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </ModalDialog>
  );
}
