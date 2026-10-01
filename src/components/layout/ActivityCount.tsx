import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
export function ActivityCount() {
  const count = useQuery({ queryKey: ['jobs', 'count'], refetchInterval: 10_000, queryFn: async () => {
    const { data, error } = await supabase.rpc('active_job_count');
    if (error) throw error;
    return data;
  } });
  return count.data ? <span className="ml-2 rounded-full bg-green-bg px-2 text-small text-green" aria-label={`${count.data} background jobs pending`}>{count.data}</span> : null;
}
