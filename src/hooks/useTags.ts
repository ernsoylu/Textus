import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

// FR-ORG-1: colored tags, many per record. RLS (§7.3) scopes tags and record_tags to the owner.
export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tags').select('id, name, color').order('name');
      if (error) throw error;
      return data;
    },
  });
}

export function useRecordTags(recordId: string) {
  return useQuery({
    queryKey: ['record-tags', recordId],
    queryFn: async () => {
      const { data, error } = await supabase.from('record_tags').select('tag_id').eq('record_id', recordId);
      if (error) throw error;
      return data.map((r) => r.tag_id);
    },
  });
}

export function useCreateTag() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async ({ name, color }: { name: string; color: string }) => {
      const { data, error } = await supabase
        .from('tags')
        .insert({ user_id: session!.user.id, name: name.trim(), color })
        .select('id')
        .single();
      if (error) throw error.code === '23505' ? new Error('You already have a tag with that name.') : error;
      return data.id;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
  });
}

export function useSetRecordTag(recordId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tagId, on }: { tagId: string; on: boolean }) => {
      const { error } = on
        ? await supabase.from('record_tags').insert({ record_id: recordId, tag_id: tagId })
        : await supabase.from('record_tags').delete().eq('record_id', recordId).eq('tag_id', tagId);
      if (error && error.code !== '23505') throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['record-tags', recordId] }),
  });
}
