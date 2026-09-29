import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export const ANNOTATION_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;

// anchor_data is JSONB (§6); validate at the trust boundary and derive the type.
// A highlighted region as fractions of the page (0–1), so it survives zoom changes (§6, annotations.anchor_data).
export const rectSchema = z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() });
export type PageRect = z.infer<typeof rectSchema>;

export const anchorSchema = z.discriminatedUnion('anchor_type', [
  z.object({ anchor_type: z.literal('pdf_page'), anchor_data: z.object({ page: z.number().int().positive(), rects: z.array(rectSchema).max(200).optional() }) }),
  z.object({ anchor_type: z.literal('epub_cfi'), anchor_data: z.object({ cfi: z.string().min(1) }) }),
]);
export type Anchor = z.infer<typeof anchorSchema>;

export interface AnnotationItem {
  id: string;
  record_id: string;
  asset_id: string;
  anchor_type: string;
  anchor_data: unknown;
  highlighted_text: string | null;
  note: string | null;
  color: string | null;
  created_at: string | null;
  records: { title: string | null; works: { title: string } | null } | null;
}

// FR-READ-4: highlights and notes anchored to an asset. Scope to one asset (reader) or take all (Notes).
export function useAnnotations(assetId?: string) {
  return useQuery({
    queryKey: ['annotations', assetId ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('annotations')
        .select('id, record_id, asset_id, anchor_type, anchor_data, highlighted_text, note, color, created_at, records(title, works(title))')
        .order('created_at');
      if (assetId) q = q.eq('asset_id', assetId);
      const { data, error } = await q.returns<AnnotationItem[]>();
      if (error) throw error;
      return data;
    },
  });
}

function useAnnotationMutation<V>(fn: (v: V, userId: string) => Promise<void>) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({ mutationFn: (v: V) => fn(v, session!.user.id), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['annotations'] }) });
}

export function useCreateAnnotation() {
  return useAnnotationMutation(async (a: { recordId: string; assetId: string; anchor: Anchor; text?: string; note?: string; color: string }, userId) => {
    const { error } = await supabase.from('annotations').insert({
      user_id: userId,
      record_id: a.recordId,
      asset_id: a.assetId,
      anchor_type: a.anchor.anchor_type,
      anchor_data: a.anchor.anchor_data,
      highlighted_text: a.text ?? null,
      note: a.note?.trim() || null,
      color: a.color,
    });
    if (error) throw error;
  });
}

export function useUpdateAnnotation() {
  return useAnnotationMutation(async ({ id, ...patch }: { id: string; note?: string; color?: string }) => {
    const { error } = await supabase.from('annotations').update(patch).eq('id', id);
    if (error) throw error;
  });
}

export function useDeleteAnnotation() {
  return useAnnotationMutation(async (id: string) => {
    const { error } = await supabase.from('annotations').delete().eq('id', id);
    if (error) throw error;
  });
}
