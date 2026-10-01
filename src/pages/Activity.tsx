import { PassageIndex } from '@/components/account/PassageIndex';
import { useJobs } from '@/hooks/useJobs';
import { jobLabel, statusText } from '@/lib/jobLabels';

const COLOR: Record<string, string> = { queued: 'text-yellow', running: 'text-yellow', succeeded: 'text-green', failed: 'text-red', cancelled: 'text-muted' };

// Figma "activity": what the background worker has done for this library — text extraction,
// metadata lookups, covers — with failures and their reasons.
export function Activity() {
  const { data, isLoading, error } = useJobs();
  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-small text-green">ACTIVITY</p>
        <p className="font-serif text-title text-fg">Quietly at work.</p>
        <p className="text-body text-muted">Files being read and metadata being looked up in the background.</p>
      </div>
      <PassageIndex />
      {isLoading && <p className="text-body text-muted">Loading…</p>}
      {error && <p className="text-body text-red">Could not load activity: {error.message}</p>}
      {data?.length === 0 && <p className="text-body text-muted">Nothing has run yet. Upload a file and its processing will show up here.</p>}
      <ul className="flex flex-col gap-2">
        {data?.map((job) => (
          <li key={job.id} className="flex flex-col gap-1 rounded-8 border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-body text-fg">{jobLabel(job)}</p>
              <p className={`text-label ${COLOR[job.status] ?? 'text-muted'}`}>{statusText(job.status)}</p>
            </div>
            <p className="text-small text-muted">
              {job.created_at ? new Date(job.created_at).toLocaleString() : ''}
              {job.attempts && job.attempts > 1 ? ` · attempt ${job.attempts} of ${job.max_attempts ?? '?'}` : ''}
            </p>
            {job.status === 'failed' && <p className="text-small text-red">This step failed after {job.attempts ?? 1} {job.attempts === 1 ? 'attempt' : 'attempts'}. The file itself is unaffected; the technical detail is in the server log.</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
