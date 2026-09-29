import type { JobItem } from '@/hooks/useJobs';

const payloadOf = (job: JobItem): Record<string, unknown> => (job.payload && typeof job.payload === 'object' ? (job.payload as Record<string, unknown>) : {});

// A sentence for a queue row: what is being done, and to what.
export function jobLabel(job: JobItem): string {
  const p = payloadOf(job);
  switch (job.job_type) {
    case 'extract_text':
      return typeof p.filename === 'string' && p.filename ? `Reading ${p.filename}` : 'Reading an uploaded file';
    case 'fetch_metadata':
      return typeof p.scheme === 'string' && typeof p.value === 'string' ? `Looking up ${p.scheme.toUpperCase()} ${p.value}` : 'Looking up metadata';
    case 'process_cover':
      return 'Fetching a cover';
    case 'generate_thumbnail':
      return 'Making a thumbnail';
    case 'export_data':
      return 'Preparing an export';
    case 'cleanup':
      return 'Tidying storage';
    default:
      return job.job_type;
  }
}

const STATUS_TEXT: Record<string, string> = { queued: 'Queued', running: 'Running', succeeded: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
export const statusText = (status: string) => STATUS_TEXT[status] ?? status;

export function metadataJobMessages(jobs: JobItem[], links: { record_id: string; asset_id: string }[], recordIds: string[]): Record<string, string> {
  const messages: Record<string, string> = {};
  for (const job of jobs) {
    if (job.status !== 'queued' && job.status !== 'running') continue;
    const payload = payloadOf(job);
    const records = job.job_type === 'fetch_metadata' ? recordIds.filter((id) => id === payload.record_id)
      : job.job_type === 'extract_text' ? links.filter((link) => link.asset_id === payload.asset_id).map((link) => link.record_id) : [];
    const message = job.job_type === 'extract_text' ? 'Searching file for ISBN or DOI…' : jobLabel(job);
    for (const id of records) messages[id] ??= `${job.status === 'queued' ? 'Queued: ' : ''}${message}`;
  }
  return messages;
}
