import { describe, expect, it } from 'vitest';
import { jobLabel, metadataJobMessages, statusText } from './jobLabels';
import type { JobItem } from '@/hooks/useJobs';

const job = (over: Partial<JobItem>): JobItem => ({ id: '1', job_type: 'cleanup', status: 'queued', attempts: 0, max_attempts: 3, last_error: null, payload: {}, created_at: null, completed_at: null, ...over });

describe('jobLabel', () => {
  it('names the work in plain words', () => {
    expect(jobLabel(job({ job_type: 'extract_text', payload: { filename: 'dune.epub' } }))).toBe('Reading dune.epub');
    expect(jobLabel(job({ job_type: 'fetch_metadata', payload: { scheme: 'doi', value: '10.1/x' } }))).toBe('Looking up DOI 10.1/x');
    expect(jobLabel(job({ job_type: 'process_cover' }))).toBe('Fetching a cover');
  });
  it('falls back to the raw type and status', () => {
    expect(jobLabel(job({ job_type: 'mystery' }))).toBe('mystery');
    expect(statusText('succeeded')).toBe('Done');
    expect(statusText('weird')).toBe('weird');
  });
  it('shows only active identifier jobs on their related records, including records without files', () => {
    const jobs = [
      job({ job_type: 'fetch_metadata', status: 'running', payload: { record_id: 'no-file', scheme: 'issn', value: '1234-5678' } }),
      job({ job_type: 'extract_text', payload: { asset_id: 'asset' } }),
      job({ job_type: 'fetch_metadata', status: 'succeeded', payload: { record_id: 'finished' } }),
      job({ job_type: 'fetch_metadata', payload: { record_id: 'elsewhere' } }),
      job({ job_type: 'process_cover', payload: { record_id: 'finished' } }),
    ];
    const links = [{ record_id: 'book', asset_id: 'asset' }, { record_id: 'copy', asset_id: 'asset' }];
    expect(metadataJobMessages(jobs, links, ['no-file', 'book', 'copy', 'finished'])).toEqual({
      'no-file': 'Looking up ISSN 1234-5678',
      book: 'Queued: Searching file for ISBN or DOI…',
      copy: 'Queued: Searching file for ISBN or DOI…',
    });
    expect(metadataJobMessages(jobs.map((j) => ({ ...j, status: 'failed' })), links, ['book'])).toEqual({});
  });
});
