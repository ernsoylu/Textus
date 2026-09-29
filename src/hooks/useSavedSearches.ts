import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { parseFilters, type LibraryFilters } from '@/lib/libraryFilters';

// FR-ORG-5: saved searches (virtual libraries) — a named LibraryFilters snapshot.
export function useSavedSearches() {
  return useQuery({
    queryKey: ['saved-searches'],
    queryFn: async () => {
      const { data, error } = await supabase.from('saved_searches').select('id, name, filters').order('name');
      if (error) throw error;
      return data.map((s) => ({ id: s.id, name: s.name, filters: parseFilters(s.filters) }));
    },
  });
}

export function useSaveSearch() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async ({ name, filters }: { name: string; filters: LibraryFilters }) => {
      const { error } = await supabase.from('saved_searches').insert({ user_id: session!.user.id, name: name.trim(), filters });
      if (error) throw error.code === '23505' ? new Error('You already have a saved search with that name.') : error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-searches'] }),
  });
}

export function useDeleteSavedSearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('saved_searches').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-searches'] }),
  });
}
