import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatByline, type Credit } from 'shared/names';

// FR-CAT-1/3 read path: a work with its records, each record's credits and contributor
// names. RLS scopes every row to the caller — no user_id filter needed here (§7.3).
interface WorkWithRecords {
  id: string;
  title: string;
  subtitle: string | null;
  work_type: string;
  records: {
    id: string;
    record_type: string;
    publication_date: string | null;
    record_contributors: {
      role: string;
      position: number;
      credited_as: string | null;
      contributors: { display_name: string } | null;
    }[];
  }[];
}

export interface WorkListItem {
  workId: string;
  title: string;
  byline: string;
  meta: string;
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
    meta: record ? `${record.record_type}${year ? ` · ${year}` : ''}` : work.work_type,
  };
}

export function useWorks() {
  return useQuery({
    queryKey: ['works'],
    queryFn: async (): Promise<WorkListItem[]> => {
      const { data, error } = await supabase
        .from('works')
        .select(
          `id, title, subtitle, work_type,
           records ( id, record_type, publication_date,
             record_contributors ( role, position, credited_as, contributors ( display_name ) ) )`,
        )
        .order('created_at', { ascending: false })
        .returns<WorkWithRecords[]>();
      if (error) throw error;
      return data.map(toListItem);
    },
  });
}
