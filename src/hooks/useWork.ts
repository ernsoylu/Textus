import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatByline, type Credit } from 'shared/names';
import type { AssetRow } from '@/types';

interface WorkDetail {
  id: string;
  title: string;
  subtitle: string | null;
  work_type: string;
  records: {
    id: string;
    title: string | null;
    record_type: string;
    publication_date: string | null;
    publisher: string | null;
    edition: string | null;
    volume: string | null;
    issue_number: string | null;
    pages: string | null;
    identifiers: { scheme: string; normalized_value: string }[];
    record_contributors: {
      role: string;
      position: number;
      credited_as: string | null;
      contributors: { display_name: string } | null;
    }[];
    record_assets: { role: string; assets: AssetRow | null }[];
  }[];
}

export function useWork(workId: string | undefined) {
  return useQuery({
    queryKey: ['works', workId],
    enabled: !!workId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('works')
        .select(
          `id, title, subtitle, work_type,
           records ( id, title, record_type, publication_date, publisher, edition, volume, issue_number, pages,
             identifiers ( scheme, normalized_value ),
             record_contributors ( role, position, credited_as, contributors ( display_name ) ),
             record_assets ( role, assets ( * ) ) )`,
        )
        .eq('id', workId!)
        .single()
        .returns<WorkDetail>();
      if (error) throw error;
      return {
        ...data,
        records: data.records.map((record) => ({
          ...record,
          byline: formatByline(
            record.record_contributors
              .filter((rc) => rc.contributors)
              .map(
                (rc): Credit => ({
                  role: rc.role,
                  position: rc.position,
                  credited_as: rc.credited_as,
                  display_name: rc.contributors!.display_name,
                }),
              ),
          ),
        })),
      };
    },
  });
}
