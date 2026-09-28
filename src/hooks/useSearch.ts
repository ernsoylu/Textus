import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// FR-SRCH-1, via the search_library() RPC (§15 open question #6). Debounced client-side —
// NFR-PERF-1 is a server-time budget, not a reason to fire the query on every keystroke.
function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function useSearch(query: string) {
  const debounced = useDebounced(query.trim(), 300);
  return useQuery({
    queryKey: ['search', debounced],
    enabled: debounced.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_library', { p_query: debounced });
      if (error) throw error;
      return data;
    },
  });
}
