import { serialCompleteness, type IssueRef } from '@/lib/serialCompleteness';

// FR-SER-2: what is held and what is missing, per volume.
export function SerialCompleteness({ issues }: { issues: IssueRef[] }) {
  const { volumes, unnumbered } = serialCompleteness(issues);
  if (!volumes.length && !unnumbered) return <p className="text-small text-muted">No issues yet.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {volumes.map((v) => (
        <li key={v.volume} className="text-small text-fg">
          {v.volume ? `Vol. ${v.volume}` : 'No volume'}: {v.have.length} of {v.max} issues
          {v.missing.length > 0 ? <span className="text-yellow"> · missing {v.missing.join(', ')}</span> : <span className="text-green"> · complete</span>}
        </li>
      ))}
      {unnumbered > 0 && <li className="text-small text-muted">{unnumbered} issue(s) without a numeric issue number</li>}
    </ul>
  );
}
