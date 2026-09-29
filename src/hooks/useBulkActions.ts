import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// FR-ORG-4: bulk tag / add to collection / delete over the selected works. Tags and
// collections attach to records, so a work's action applies to all of its records.
// RLS scopes every write to the owner (§7.3); duplicates are ignored so re-applying is a no-op.
export function useBulkActions() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries();

  const tag = useMutation({
    mutationFn: async ({ recordIds, tagId }: { recordIds: string[]; tagId: string }) => {
      const { error } = await supabase
        .from('record_tags')
        .upsert(recordIds.map((record_id) => ({ record_id, tag_id: tagId })), { onConflict: 'record_id,tag_id', ignoreDuplicates: true });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const addToCollection = useMutation({
    mutationFn: async ({ recordIds, collectionId }: { recordIds: string[]; collectionId: string }) => {
      const { data: last } = await supabase.from('collection_records').select('display_order').eq('collection_id', collectionId).order('display_order', { ascending: false }).limit(1);
      const start = (last?.[0]?.display_order ?? -1) + 1;
      const { error } = await supabase
        .from('collection_records')
        .upsert(recordIds.map((record_id, i) => ({ collection_id: collectionId, record_id, display_order: start + i })), { onConflict: 'collection_id,record_id', ignoreDuplicates: true });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const deleteWorks = useMutation({
    mutationFn: async (workIds: string[]) => {
      const { error } = await supabase.from('works').delete().in('id', workIds);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  return { tag, addToCollection, deleteWorks };
}
