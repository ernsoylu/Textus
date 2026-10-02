import { Link } from 'react-router-dom';
import { activityView, type ActivityRow, type StepState } from '@/lib/activityStage';
import { Button } from '@/components/ui/button';

const STEP: Record<StepState, { icon: string; color: string; label: string }> = {
  done: { icon: '✓', color: 'text-green', label: 'done' }, active: { icon: '●', color: 'text-yellow', label: 'in progress' },
  waiting: { icon: '○', color: 'text-muted', label: 'waiting' }, failed: { icon: '!', color: 'text-red', label: 'failed' }, skipped: { icon: '–', color: 'text-muted', label: 'not applicable' },
};
const STATUS_COLOR = { attention: 'text-red', progress: 'text-yellow', waiting: 'text-muted', done: 'text-green' };

// One book's way through reading, metadata, full-text indexing and AI search.
export function BookActivity({ row, busy, onControl }: Readonly<{ row: ActivityRow; busy: boolean; onControl: (action: 'retry' | 'cancel' | 'reindex', asset: string) => void }>) {
  const view = activityView(row);
  return (
    <li className="flex flex-col gap-2 rounded-8 border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/library/${row.work_id}`} className="break-words text-body text-fg hover:underline">{row.title}</Link>
          {row.byline && <p className="text-small text-muted">{row.byline}</p>}
        </div>
        <span className={`shrink-0 text-label ${STATUS_COLOR[view.group]}`}>{view.status}</span>
      </div>
      <ol aria-label="Processing steps" className="flex flex-wrap gap-x-4 gap-y-1 text-small">
        {view.steps.map((step) => <li key={step.label} className={STEP[step.state].color}><span aria-hidden="true">{STEP[step.state].icon} </span>{step.label}<span className="sr-only">: {STEP[step.state].label}</span></li>)}
      </ol>
      <div role="progressbar" aria-label={`${row.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.progress} className="h-2 overflow-hidden rounded-full bg-raised">
        <div className={`h-full ${view.group === 'attention' ? 'bg-red' : 'bg-green'}`} style={{ width: `${view.progress}%` }} />
      </div>
      <p className="text-small text-muted">{view.explanation}</p>
      {(view.canRetry || view.canCancel || view.canReindex) && (
        <div className="flex gap-2">
          {view.canRetry && <Button variant="secondary" disabled={busy} onClick={() => onControl('retry', row.asset_id)}>Retry</Button>}
          {view.canCancel && <Button variant="ghost" disabled={busy} onClick={() => onControl('cancel', row.asset_id)}>Cancel</Button>}
          {view.canReindex && (
            <details className="text-small">
              <summary className="cursor-pointer text-muted">More</summary>
              <Button variant="ghost" disabled={busy} onClick={() => onControl('reindex', row.asset_id)}>Reindex from the start</Button>
            </details>
          )}
        </div>
      )}
    </li>
  );
}
