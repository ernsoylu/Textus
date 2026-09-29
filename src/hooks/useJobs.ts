import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

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
