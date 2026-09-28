import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useAsset(assetId: string | undefined) {
  return useQuery({
    queryKey: ['assets', assetId],
    enabled: !!assetId,
    queryFn: async () => {
      const { data, error } = await supabase.from('assets').select('id, bucket, storage_path, file_format').eq('id', assetId!).single();
      if (error) throw error;
      return data;
    },
  });
}
