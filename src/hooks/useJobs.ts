import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { metadataJobMessages } from '@/lib/jobLabels';

// Background work for the Activity page (§7.5): the caller's own rows from the `jobs` queue
// (jobs_select_own). Polls every few seconds while something is still queued or running.
export interface JobItem {
  id: string;
  job_type: string;
  status: string;
  attempts: number | null;
  max_attempts: number | null;
  last_error: string | null;
  payload: unknown;
  created_at: string | null;
  completed_at: string | null;
}

const ACTIVE = new Set(['queued', 'running']);

export function useJobs() {
  return useQuery({
    queryKey: ['jobs'],
    refetchInterval: (query) => ((query.state.data as JobItem[] | undefined)?.some((j) => ACTIVE.has(j.status)) ? 4000 : false),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, job_type, status, attempts, max_attempts, last_error, payload, created_at, completed_at')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as JobItem[];
    },
  });
}

export function useMetadataJobs(recordIds: string[]) {
  const client = useQueryClient();
  const previous = useRef<string[]>([]);
  const query = useQuery({
    queryKey: ['jobs', 'metadata', recordIds],
    enabled: recordIds.length > 0,
    refetchInterval: 4000,
    queryFn: async () => {
      const [jobs, links] = await Promise.all([
        supabase.from('jobs').select('id, job_type, status, attempts, max_attempts, last_error, payload, created_at, completed_at').in('status', ['queued', 'running']).in('job_type', ['extract_text', 'fetch_metadata']).order('created_at', { ascending: false }),
        supabase.from('record_assets').select('record_id, asset_id').in('record_id', recordIds),
      ]);
      if (jobs.error) throw jobs.error;
      if (links.error) throw links.error;
      return metadataJobMessages(jobs.data, links.data, recordIds);
    },
  });
  useEffect(() => {
    const messages = query.data;
    if (!messages) return;
    if (previous.current.some((id) => !messages[id])) void client.invalidateQueries({ queryKey: ['works'] });
    previous.current = Object.keys(messages);
  }, [client, query.data]);
  return query;
}
