import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSerial } from '@/hooks/useSerials';
import { serialCompleteness } from '@/lib/serialCompleteness';
import { AddIssueForm } from '@/components/library/AddIssueForm';
import { ExpectedIssuesDialog } from '@/components/library/ExpectedIssuesDialog';
import { Button } from '@/components/ui/button';

const ALL = '__all__';

// Figma "serial detail": one journal or magazine — its issue grid per volume, what is missing against the
// expected run, and the controls to add issues and define that run (FR-SER-1/2).
export function SerialDetail() {
  const { workId } = useParams<{ workId: string }>();
  const { data, isLoading, error } = useSerial(workId);
  const [volume, setVolume] = useState(ALL);
  const [adding, setAdding] = useState(false);
  const [editingRun, setEditingRun] = useState(false);

  const completeness = useMemo(() => (data ? serialCompleteness(data.issues, data.expected) : null), [data]);
  if (isLoading) return <p className="text-body text-muted">Loading…</p>;
  if (error || !data || !completeness) return <p className="text-body text-red">This serial could not be found. <Link to="/serials" className="underline">Back to serials</Link></p>;

  const shown = completeness.volumes.filter((v) => volume === ALL || v.volume === volume);
  const label = (v: string) => v || 'No volume';
  const tracked = shown.reduce((n, v) => n + (v.expected?.length ?? v.have.length + v.missing.length), 0);
  const held = shown.reduce((n, v) => n + (v.expected ? v.have.filter((x) => v.expected!.includes(x)).length : v.have.length), 0);
  const gaps = shown.reduce((n, v) => n + v.missing.length, 0);
  const issueByKey = new Map(data.issues.map((i) => [`${i.volume?.trim() ?? ''}:${i.issue_number?.trim() ?? ''}`, i]));

  return (
    <div className="flex max-w-[900px] flex-col gap-4">
      <Link to="/serials" className="text-small text-muted underline">Serials</Link>
      <p className="text-small text-green">SERIAL</p>
      <p className="font-serif text-title text-fg">{data.title}</p>
      <p className="text-body text-muted">{held} of {tracked} tracked {tracked === 1 ? 'issue' : 'issues'}</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setAdding((v) => !v)}>Add issue</Button>
        <Link to={`/library/${data.id}`}><Button variant="secondary">Edit serial</Button></Link>
      </div>
      {adding && <AddIssueForm workId={data.id} />}

      {completeness.volumes.length > 0 && (
        <div role="tablist" aria-label="Volume" className="flex flex-wrap gap-2">
          {[...completeness.volumes.map((v) => v.volume), ALL].map((v) => (
            <button key={v} type="button" role="tab" aria-selected={volume === v} onClick={() => setVolume(v)} className={`rounded-8 px-3 py-2 text-label ${volume === v ? 'bg-green-bg text-green' : 'text-muted hover:text-fg'}`}>
              {v === ALL ? 'All years' : label(v)}
            </button>
          ))}
        </div>
      )}

      {gaps > 0 && <p className="rounded-8 bg-yellow-bg p-3 text-small text-yellow">{gaps} {gaps === 1 ? 'gap' : 'gaps'} in your tracked run. Completeness uses the issues you expect.</p>}
      {completeness.volumes.length === 0 && <p className="text-body text-muted">No numbered issues yet. Add an issue, or define the run you collect.</p>}

      {shown.map((v) => {
        const numbers = [...new Set([...v.have, ...(v.expected ?? []), ...v.missing])].sort((a, b) => a - b);
        return (
          <section key={v.volume} className="flex flex-col gap-2" aria-label={label(v.volume)}>
            {volume === ALL && <p className="text-label text-fg">{label(v.volume)}</p>}
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {numbers.map((n) => {
                const issue = issueByKey.get(`${v.volume}:${n}`);
                const present = v.have.includes(n);
                return (
                  <li key={n} className={`flex flex-col gap-1 rounded-8 p-3 ${present ? 'bg-raised' : 'border border-fg'}`}>
                    <span className="text-heading text-fg">{String(n).padStart(2, '0')}</span>
                    {present ? <span className="text-small text-green">{issue ? <Link to={`/library/${data.id}`} className="underline">In library</Link> : 'In library'}</span> : <span className="text-small text-yellow">Missing</span>}
                  </li>
                );
              })}
            </ul>
            {v.extra.length > 0 && <p className="text-small text-muted">Also held, outside the run: {v.extra.join(', ')}</p>}
          </section>
        );
      })}
      {completeness.unnumbered > 0 && <p className="text-small text-muted">{completeness.unnumbered} issue(s) without a numeric issue number are not counted.</p>}

      <div><Button variant="secondary" onClick={() => setEditingRun(true)}>Set expected issues</Button></div>
      <ExpectedIssuesDialog workId={data.id} expected={data.expected} initialVolume={volume === ALL ? (completeness.volumes[0]?.volume ?? '') : volume} open={editingRun} onClose={() => setEditingRun(false)} />
    </div>
  );
}
