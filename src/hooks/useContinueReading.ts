import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// The most recently read record that is still in progress, for the Overview's "Pick up where you left off".
export function useContinueReading() {
  return useQuery({
    queryKey: ['continue-reading'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_states')
        .select('record_id, asset_id, progress_percentage, last_read_at, records(work_id)')
        .eq('status', 'reading')
        .not('asset_id', 'is', null)
        .order('last_read_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data?.asset_id || !data.records) return null;
      return { workId: data.records.work_id, recordId: data.record_id, assetId: data.asset_id, progress: Number(data.progress_percentage ?? 0), lastReadAt: data.last_read_at };
    },
  });
}
