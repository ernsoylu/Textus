import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { formatByline, type Credit } from 'shared/names';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';
import type { LibraryFilters } from '@/lib/libraryFilters';

// The Library, one page at a time, from library_page() (NFR-PERF-1): filtering, sorting, searching and paging all
// happen in Postgres, so the browser never holds more than the pages it has shown.
export interface WorkListItem {
  workId: string;
  workType: string;
  readerPath: string | null;
  title: string;
  byline: string;
  meta: string; // "edition · 2019"
  detail: string; // "EPUB · 42% read"
  coverPath: string | null; // in the private covers bucket
  recordIds: string[];
  userRating?: number | null;
}

export const PAGE_SIZE = 48;

type Row = Database['public']['Functions']['library_page']['Returns'][number];

// credits comes back as JSONB; validate it at the trust boundary.
const creditsSchema = z.array(z.object({ role: z.string(), position: z.number(), credited_as: z.string().nullable(), display_name: z.string() }));

function detailLine(row: Row): string {
  const formats = (row.formats ?? []).map((f) => f.toUpperCase());
  const progress = Number(row.progress ?? 0);
  return [...formats, progress > 0 ? `${Math.round(progress)}% read` : ''].filter(Boolean).join(' · ');
}

function toItem(row: Row): WorkListItem {
  const credits: Credit[] = creditsSchema.catch([]).parse(row.credits);
  const year = row.publication_date ? new Date(row.publication_date).getFullYear() : null;
  return {
    workId: row.work_id,
    workType: row.work_type,
    readerPath: row.read_record_id && row.read_asset_id ? `/library/${row.work_id}/records/${row.read_record_id}/assets/${row.read_asset_id}/read` : null,
    title: row.title,
    byline: formatByline(credits),
    meta: row.record_type ? [row.record_type, year].filter(Boolean).join(' · ') : row.work_type,
    detail: detailLine(row),
    coverPath: row.cover_path,
    recordIds: row.record_ids ?? [],
    userRating: row.work_type === 'book' ? row.user_rating : null,
  };
}

interface PageParams {
  filters?: Partial<LibraryFilters>;
  ids?: string[];
  limit: number;
  offset: number;
}

async function fetchPage({ filters = {}, ids, limit, offset }: PageParams): Promise<{ items: WorkListItem[]; total: number }> {
  const { data, error } = await supabase.rpc('library_page', {
    p_q: filters.q?.trim() || undefined,
    p_work_type: filters.workType || undefined,
    p_tag: filters.tagId || undefined,
    p_collection: filters.collectionId || undefined,
    p_status: filters.status || undefined,
    p_format: filters.format || undefined,
    p_language: filters.language || undefined,
    p_ids: ids,
    p_sort: filters.sort ?? 'added',
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return { items: data.map(toItem), total: Number(data[0]?.total ?? 0) };
}

// Query keys start with 'works' so the many existing invalidateQueries({ queryKey: ['works'] }) calls refresh the list.
// Infinite list for the Library page. The query key carries the filters, so changing one starts a fresh list.
export function useLibrary(filters: LibraryFilters) {
  return useInfiniteQuery({
    queryKey: ['works', 'library', filters],
    refetchInterval: 10_000,
    initialPageParam: 0,
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => fetchPage({ filters, limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length > 0 && loaded < last.total ? loaded : undefined;
    },
  });
}

// A small fixed slice (Overview: the newest four, or one specific work).
export function useLibraryItems(opts: { limit: number; ids?: string[]; enabled?: boolean; filters?: Partial<LibraryFilters> }) {
  return useQuery({
    queryKey: ['works', 'library', 'items', opts.limit, opts.ids, opts.filters],
    refetchInterval: 10_000,
    enabled: opts.enabled ?? true,
    queryFn: async () => (await fetchPage({ ids: opts.ids, filters: opts.filters, limit: opts.limit, offset: 0 })).items,
  });
}

export function useLanguages() {
  return useQuery({
    queryKey: ['works', 'library', 'languages'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('library_languages');
      if (error) throw error;
      return data.map((r) => r.language);
    },
  });
}
