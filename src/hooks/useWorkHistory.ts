import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const PAGE = 50;
export type HistoryActor = 'all' | 'user' | 'agent' | 'ai' | 'textus';

// A book's history, newest first, 50 events per page, optionally limited to one kind of actor.
export function useWorkHistory(workId: string | undefined, actor: HistoryActor) {
  return useInfiniteQuery({
    queryKey: ['work-history', workId, actor],
    enabled: !!workId,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let query = supabase.from('work_events').select('id,actor,actor_detail,event,summary,changes,created_at').eq('work_id', workId!);
      if (actor !== 'all') query = query.eq('actor', actor);
      const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(pageParam, pageParam + PAGE - 1);
      if (error) throw error;
      return data;
    },
    getNextPageParam: (last, pages) => (last.length === PAGE ? pages.length * PAGE : undefined),
  });
}
