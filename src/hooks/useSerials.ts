import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// FR-SER-1/2: serial works with their issue records (volume + number) for completeness.
export function useSerials() {
  return useQuery({
    queryKey: ['serials'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('works')
        .select('id, title, records ( record_type, volume, issue_number )')
        .eq('work_type', 'serial')
        .order('title');
      if (error) throw error;
      return data.map((w) => ({ id: w.id, title: w.title, issues: w.records.filter((r) => r.record_type === 'issue') }));
    },
  });
}
