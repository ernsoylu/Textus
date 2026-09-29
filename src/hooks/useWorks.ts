import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatByline, type Credit } from 'shared/names';
import type { FilterableWork } from '@/lib/libraryFilters';

// FR-CAT-1/3 read path: a work with its records, each record's credits and contributor
// names. RLS scopes every row to the caller — no user_id filter needed here (§7.3).
interface WorkWithRecords {
  id: string;
  title: string;
  subtitle: string | null;
  work_type: string;
  language: string | null;
  created_at: string | null;
  records: {
    id: string;
    record_type: string;
    publication_date: string | null;
    record_tags: { tag_id: string }[];
    collection_records: { collection_id: string }[];
    record_assets: { role: string; assets: { file_format: string; bucket: string; storage_path: string } | null }[];
    reading_states: { status: string; last_read_at: string | null; progress_percentage: number | null }[];
    record_contributors: {
      role: string;
      position: number;
      credited_as: string | null;
      contributors: { display_name: string } | null;
    }[];
  }[];
}

export interface WorkListItem extends FilterableWork {
  recordIds: string[];
  meta: string;
  detail: string; // "EPUB · 42% read"
  coverPath: string | null; // in the private covers bucket
}

function firstCoverPath(records: WorkWithRecords['records']): string | null {
  for (const r of records) {
    for (const a of r.record_assets) {
      if (a.role === 'cover' && a.assets?.bucket === 'covers') return a.assets.storage_path;
    }
  }
  return null;
}

// "EPUB · PDF · 42% read": the readable formats and the furthest progress across the work's records.
function detailLine(records: WorkWithRecords['records']): string {
  const formats = [...new Set(records.flatMap((r) => r.record_assets.flatMap((a) => (a.assets && a.role !== 'cover' ? [a.assets.file_format.toUpperCase()] : []))))];
  const progress = Math.max(0, ...records.flatMap((r) => r.reading_states.map((s) => Number(s.progress_percentage ?? 0))));
  return [...formats, progress > 0 ? `${Math.round(progress)}% read` : ''].filter(Boolean).join(' · ');
}

function toListItem(work: WorkWithRecords): WorkListItem {
  const record = work.records[0];
  const credits: Credit[] = (record?.record_contributors ?? [])
    .filter((rc) => rc.contributors)
    .map((rc) => ({
      role: rc.role,
      position: rc.position,
      credited_as: rc.credited_as,
      display_name: rc.contributors!.display_name,
    }));
  const year = record?.publication_date ? new Date(record.publication_date).getFullYear() : null;
  return {
    workId: work.id,
    title: work.title,
    byline: formatByline(credits),
    meta: record ? [record.record_type, year].filter(Boolean).join(' · ') : work.work_type,
    recordIds: work.records.map((r) => r.id),
    coverPath: firstCoverPath(work.records),
    detail: detailLine(work.records),
    workType: work.work_type,
    language: work.language,
    addedAt: work.created_at ?? '',
    publishedAt: work.records.map((r) => r.publication_date).filter((d): d is string => !!d).sort((a, b) => a.localeCompare(b))[0] ?? null,
    tagIds: [...new Set(work.records.flatMap((r) => r.record_tags.map((t) => t.tag_id)))],
    collectionIds: [...new Set(work.records.flatMap((r) => r.collection_records.map((c) => c.collection_id)))],
    formats: [...new Set(work.records.flatMap((r) => r.record_assets.flatMap((a) => (a.assets ? [a.assets.file_format] : []))))],
    statuses: [...new Set(work.records.map((r) => r.reading_states[0]?.status ?? 'unread'))],
    lastReadAt: work.records.flatMap((r) => r.reading_states.map((s) => s.last_read_at)).filter((d): d is string => !!d).sort((a, b) => a.localeCompare(b)).at(-1) ?? null,
  };
}

export function useWorks() {
  return useQuery({
    queryKey: ['works'],
    queryFn: async (): Promise<WorkListItem[]> => {
      const { data, error } = await supabase
        .from('works')
        .select(
          `id, title, subtitle, work_type, language, created_at,
           records ( id, record_type, publication_date,
             record_tags ( tag_id ), collection_records ( collection_id ), record_assets ( role, assets ( file_format, bucket, storage_path ) ),
             reading_states ( status, last_read_at, progress_percentage ),
             record_contributors ( role, position, credited_as, contributors ( display_name ) ) )`,
        )
        .order('created_at', { ascending: false })
        .returns<WorkWithRecords[]>();
      if (error) throw error;
      return data.map(toListItem);
    },
  });
}
