import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

// FR-ORG-2: collections (shelves) with manual ordering via collection_records.display_order.
export function useCollections() {
  return useQuery({
    queryKey: ['collections'],
    queryFn: async () => {
      const { data, error } = await supabase.from('collections').select('id, name, description, collection_records(count)').order('name');
      if (error) throw error;
      return data.map((c) => ({ id: c.id, name: c.name, description: c.description, count: c.collection_records[0]?.count ?? 0 }));
    },
  });
}

export function useCreateCollection() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from('collections').insert({ user_id: session!.user.id, name: name.trim() });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['collections'] }),
  });
}

export function useDeleteCollection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('collections').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['collections'] }),
  });
}

export function useCollectionRecords(collectionId: string | undefined) {
  return useQuery({
    queryKey: ['collection-records', collectionId],
    enabled: !!collectionId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('collection_records')
        .select('record_id, display_order, records(title, work_id, works(title))')
        .eq('collection_id', collectionId!)
        .order('display_order')
        .order('added_at');
      if (error) throw error;
      return data.map((r) => ({
        recordId: r.record_id,
        workId: r.records?.work_id ?? '',
        title: r.records?.title || r.records?.works?.title || 'Untitled',
      }));
    },
  });
}

export function useRecordCollections(recordId: string) {
  return useQuery({
    queryKey: ['record-collections', recordId],
    queryFn: async () => {
      const { data, error } = await supabase.from('collection_records').select('collection_id').eq('record_id', recordId);
      if (error) throw error;
      return data.map((r) => r.collection_id);
    },
  });
}

function invalidateMembership(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['collection-records'] });
  queryClient.invalidateQueries({ queryKey: ['record-collections'] });
  queryClient.invalidateQueries({ queryKey: ['collections'] });
}

export function useSetCollectionMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ collectionId, recordId, on }: { collectionId: string; recordId: string; on: boolean }) => {
      if (on) {
        // Append after the current last item.
        const { data: last } = await supabase.from('collection_records').select('display_order').eq('collection_id', collectionId).order('display_order', { ascending: false }).limit(1);
        const { error } = await supabase.from('collection_records').insert({ collection_id: collectionId, record_id: recordId, display_order: (last?.[0]?.display_order ?? -1) + 1 });
        if (error && error.code !== '23505') throw error;
      } else {
        const { error } = await supabase.from('collection_records').delete().eq('collection_id', collectionId).eq('record_id', recordId);
        if (error) throw error;
      }
    },
    onSuccess: () => invalidateMembership(queryClient),
  });
}

// Persists the full order (positions 0..n-1) after a move; fine at shelf sizes.
// ponytail: n UPDATEs per move, add an RPC if collections grow into the thousands.
export function useReorderCollection(collectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderedRecordIds: string[]) => {
      const results = await Promise.all(
        orderedRecordIds.map((recordId, i) =>
          supabase.from('collection_records').update({ display_order: i }).eq('collection_id', collectionId).eq('record_id', recordId),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['collection-records', collectionId] }),
  });
}
