import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// Covers live in the private `covers` bucket (invariant 7): 300 s signed URLs, never public ones.
// Re-signed a minute before expiry; the whole library is signed in one call.
// ponytail: signs every cover in the library, sign only the visible page once the list is paginated.
export function useCoverUrls(paths: string[]) {
  const key = [...new Set(paths)].sort((a, b) => a.localeCompare(b));
  return useQuery({
    queryKey: ['cover-urls', key],
    enabled: key.length > 0,
    staleTime: 240_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('covers').createSignedUrls(key, 300);
      if (error) throw error;
      return new Map(data.flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])));
    },
  });
}
