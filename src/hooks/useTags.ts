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
    mutationFn: async ({ name }: { name: string }) => {
      const colors = ['#b4ca92', '#7fbbb3', '#e67e80', '#dbbc7f', '#83c092', '#d699b6'];
      const color = colors[crypto.getRandomValues(new Uint32Array(1))[0] % colors.length];
      const { data, error } = await supabase
        .from('tags')
        .insert({ user_id: session!.user.id, name: name.trim(), color })
        .select('id')
        .single();
      if (error) throw error.code === '23505' ? new Error('You already have a tag with that name.') : error;
      return data.id;
    },
    onSuccess: () => invalidateTags(queryClient),
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

// Tags page: every tag with how many records, collections and notes carry it.
export function useTagList() {
  return useQuery({
    queryKey: ['tag-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tags').select('id, name, color, record_tags(count), collection_tags(count), annotation_tags(count)').order('name');
      if (error) throw error;
      return data.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        count: t.record_tags[0]?.count ?? 0,
        collections: t.collection_tags[0]?.count ?? 0,
        notes: t.annotation_tags[0]?.count ?? 0,
      }));
    },
  });
}

// One tag's page: the records and collections it labels (its notes come from useAnnotations, filtered).
export function useTagItems(tagId: string | undefined) {
  return useQuery({
    queryKey: ['tag-items', tagId],
    enabled: !!tagId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tags')
        .select('id, name, color, record_tags(records(id, title, work_id, works(title))), collection_tags(collections(id, name, description))')
        .eq('id', tagId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        tag: { id: data.id, name: data.name, color: data.color },
        records: data.record_tags.flatMap((r) => (r.records ? [r.records] : [])),
        collections: data.collection_tags.flatMap((c) => (c.collections ? [c.collections] : [])),
      };
    },
  });
}

export function useCollectionTags(collectionId: string) {
  return useQuery({
    queryKey: ['collection-tags', collectionId],
    queryFn: async () => {
      const { data, error } = await supabase.from('collection_tags').select('tag_id').eq('collection_id', collectionId);
      if (error) throw error;
      return data.map((r) => r.tag_id);
    },
  });
}

export function useSetCollectionTag(collectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tagId, on }: { tagId: string; on: boolean }) => {
      const { error } = on
        ? await supabase.from('collection_tags').insert({ collection_id: collectionId, tag_id: tagId })
        : await supabase.from('collection_tags').delete().eq('collection_id', collectionId).eq('tag_id', tagId);
      if (error && error.code !== '23505') throw error;
    },
    onSuccess: () => {
      for (const key of ['collection-tags', 'tag-list', 'tag-items']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}

function invalidateTags(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of ['tags', 'tag-list', 'tag-items', 'record-tags', 'collection-tags', 'annotations', 'works']) queryClient.invalidateQueries({ queryKey: [key] });
}

export function useUpdateTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('tags').update({ name: name.trim() }).eq('id', id);
      if (error) throw error.code === '23505' ? new Error('You already have a tag with that name.') : error;
    },
    onSuccess: () => invalidateTags(queryClient),
  });
}

// record_tags rows go with the tag (ON DELETE CASCADE); the records themselves are untouched.
export function useDeleteTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tags').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateTags(queryClient),
  });
}
