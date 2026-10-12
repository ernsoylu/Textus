import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export const ANNOTATION_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
// Stored as names; painted as soft highlighter tones (CSS "green" and "blue" would bury the text).
const HIGHLIGHT_FILLS: Record<string, string> = { yellow: '#f7e26b', green: '#9fe08c', blue: '#8cc8f2', pink: '#f4a6c8' };
export const highlightFill = (color: string | null | undefined) => HIGHLIGHT_FILLS[color ?? 'yellow'] ?? color ?? HIGHLIGHT_FILLS.yellow;

// anchor_data is JSONB (§6); validate at the trust boundary and derive the type.
// A highlighted region as fractions of the page (0–1), so it survives zoom changes (§6, annotations.anchor_data).
export const rectSchema = z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() });
export type PageRect = z.infer<typeof rectSchema>;

// FR-READ-10: one pen or highlighter stroke on a PDF page. Points are [x, y] or [x, y, pressure] in unrotated
// page fractions (0–1); width is a fraction of the page width, so ink scales with the page, never the view.
// Bounds match the database trigger (migration 20261012000001_pdf_ink.sql).
export const INK_MAX_POINTS = 2000;
const unit = z.number().min(0).max(1);
export const inkDataSchema = z.object({
  v: z.literal(1),
  page: z.number().int().positive(),
  tool: z.enum(['pen', 'highlighter']),
  width: z.number().min(0.0005).max(0.05),
  points: z.array(z.union([z.tuple([unit, unit]), z.tuple([unit, unit, unit])])).min(1).max(INK_MAX_POINTS),
});
export type InkData = z.infer<typeof inkDataSchema>;

export const anchorSchema = z.discriminatedUnion('anchor_type', [
  z.object({ anchor_type: z.literal('pdf_page'), anchor_data: z.object({ page: z.number().int().positive(), rects: z.array(rectSchema).max(200).optional() }) }),
  z.object({ anchor_type: z.literal('epub_cfi'), anchor_data: z.object({ cfi: z.string().min(1) }) }),
  z.object({ anchor_type: z.literal('pdf_ink'), anchor_data: inkDataSchema }),
]);
export type Anchor = z.infer<typeof anchorSchema>;

// Pen colors; the highlighter uses the highlight colors above.
export const INK_COLORS = ['black', 'blue', 'red', 'green'] as const;
const INK_FILLS: Record<string, string> = { black: '#232a2e', blue: '#2f6fb0', red: '#c8414b', green: '#3a8a4a' };
export const inkFill = (tool: InkData['tool'], color: string | null) => (tool === 'pen' ? (INK_FILLS[color ?? 'black'] ?? INK_FILLS.black) : highlightFill(color));

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
  updated_at: string | null;
  records: { title: string | null; work_id: string; works: { title: string } | null } | null;
  annotation_tags: { tag_id: string }[];
}

export const bookTitle = (a: AnnotationItem) => a.records?.title || a.records?.works?.title || 'Untitled';

/** The page of a fixed-page note, highlight or drawing; undefined for book CFIs and unknown kinds. */
export function notePage(a: Pick<AnnotationItem, 'anchor_type' | 'anchor_data'>): number | undefined {
  const page = a.anchor_type === 'pdf_page' || a.anchor_type === 'pdf_ink' ? (a.anchor_data as { page?: unknown } | null)?.page : undefined;
  return typeof page === 'number' ? page : undefined;
}

export const isInk = (a: Pick<AnnotationItem, 'anchor_type'>) => a.anchor_type === 'pdf_ink';
/**
 * Pen ink: handwriting and drawings, listed per page. A freehand *highlighter* stroke is a highlight like any other:
 * it keeps the text it covers as highlighted_text and is listed, searched and exported as a note.
 */
export const isDrawing = (a: Pick<AnnotationItem, 'anchor_type' | 'anchor_data'>) => isInk(a) && (a.anchor_data as { tool?: unknown } | null)?.tool !== 'highlighter';

/** Pen strokes are one row each; lists show them per page instead (first stroke links to the page). */
export function inkPages(items: AnnotationItem[]): { page: number; count: number; first: AnnotationItem }[] {
  const pages = new Map<string, { page: number; count: number; first: AnnotationItem }>();
  for (const a of items) {
    const page = isDrawing(a) ? notePage(a) : undefined;
    if (!page) continue;
    const key = `${a.asset_id}:${page}`;
    const entry = pages.get(key);
    if (entry) entry.count++;
    else pages.set(key, { page, count: 1, first: a });
  }
  return [...pages.values()].sort((x, y) => x.page - y.page);
}

export function noteLocation(a: AnnotationItem): string {
  const page = notePage(a);
  return page ? `Page ${page}` : '';
}

/** The reader page for an annotation, opened at it with its comment showing. */
export const annotationHref = (a: AnnotationItem) => `/library/${a.records?.work_id}/records/${a.record_id}/assets/${a.asset_id}/read?annotation=${a.id}`;

// FR-READ-4: highlights and notes anchored to an asset. Scope to one asset (reader) or take all (Notes).
export function useAnnotations(assetId?: string) {
  return useQuery({
    queryKey: ['annotations', assetId ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('annotations')
        .select('id, record_id, asset_id, anchor_type, anchor_data, highlighted_text, note, color, created_at, updated_at, records(title, work_id, works(title)), annotation_tags(tag_id)')
        .order('created_at');
      if (assetId) q = q.eq('asset_id', assetId);
      const { data, error } = await q.returns<AnnotationItem[]>();
      if (error) throw error;
      return data;
    },
  });
}

function useAnnotationMutation<V, R = void>(fn: (v: V, userId: string) => Promise<R>) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const refresh = () => {
    for (const key of ['annotations', 'tag-list']) queryClient.invalidateQueries({ queryKey: [key] });
  };
  // Refetch after a failure too: a conflict must show the newer server revision.
  return useMutation({ mutationFn: (v: V) => fn(v, session!.user.id), onSuccess: refresh, onError: refresh });
}

export interface NewAnnotation {
  /** Client operation ID (FR-READ-12): retrying with the same ID after a lost response cannot create a second row. */
  id: string;
  recordId: string;
  assetId: string;
  anchor: Anchor;
  text?: string;
  note?: string;
  color: string;
}

export async function saveAnnotation(a: NewAnnotation, userId: string): Promise<string> {
  const { error } = await supabase.from('annotations').upsert({
    id: a.id,
    user_id: userId,
    record_id: a.recordId,
    asset_id: a.assetId,
    anchor_type: a.anchor.anchor_type,
    anchor_data: a.anchor.anchor_data,
    highlighted_text: a.text ?? null,
    note: a.note?.trim() || null,
    color: a.color,
  }, { onConflict: 'id' });
  if (error) throw error;
  return a.id;
}

export function useCreateAnnotation() {
  return useAnnotationMutation(saveAnnotation);
}

export class ConflictError extends Error {
  constructor() {
    super('This note was changed on another device. Your text is kept: keep yours (then save) or use the saved version.');
  }
}

// `expected` is the updated_at the edit started from: a newer server revision is never silently overwritten.
export function useUpdateAnnotation() {
  return useAnnotationMutation(async ({ id, expected, ...patch }: { id: string; expected?: string | null; note?: string; color?: string }) => {
    let q = supabase.from('annotations').update(patch).eq('id', id);
    if (expected) q = q.eq('updated_at', expected);
    const { data, error } = await q.select('id');
    if (error) throw error;
    if (!data.length) throw new ConflictError();
  });
}

export async function deleteAnnotations(ids: string[]) {
  const { error } = await supabase.from('annotations').delete().in('id', ids);
  if (error) throw error;
}

export function useDeleteAnnotation() {
  return useAnnotationMutation((id: string) => deleteAnnotations([id]));
}

// FR-ORG-1: tags on notes. The tag itself is the user's own (RLS on annotation_tags checks both sides).
export function useSetAnnotationTag() {
  return useAnnotationMutation(async ({ annotationId, tagId, on }: { annotationId: string; tagId: string; on: boolean }) => {
    const { error } = on
      ? await supabase.from('annotation_tags').insert({ annotation_id: annotationId, tag_id: tagId })
      : await supabase.from('annotation_tags').delete().eq('annotation_id', annotationId).eq('tag_id', tagId);
    if (error && error.code !== '23505') throw error;
  });
}
