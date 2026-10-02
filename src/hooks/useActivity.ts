import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Every book file's processing state; refreshed while the Activity page is open.
export function useActivity() {
  return useQuery({
    queryKey: ['activity'],
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('activity_overview');
      if (error) throw error;
      return data;
    },
  });
}
