import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatByline, type Credit } from 'shared/names';
import type { AssetRow } from '@/types';

interface WorkDetail {
  id: string;
  title: string;
  subtitle: string | null;
  abstract: string | null;
  language: string | null;
  work_type: string;
  metadata: import('@/types/database').Json;
  records: {
    id: string;
    title: string | null;
    record_type: string;
    publication_date: string | null;
    publication_date_precision: string | null;
    publisher: string | null;
    edition: string | null;
    volume: string | null;
    issue_number: string | null;
    pages: string | null;
    metadata: import('@/types/database').Json | null;
    metadata_source: string | null;
    metadata_fetched_at: string | null;
    identifiers: { scheme: string; normalized_value: string }[];
    record_contributors: {
      role: string;
      contributor_id: string;
      position: number;
      credited_as: string | null;
      contributors: {
        display_name: string;
        kind: string;
        family_name: string | null;
        given_names: string | null;
        particle: string | null;
        suffix: string | null;
      } | null;
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
          `id, title, subtitle, abstract, language, work_type, metadata,
           records ( id, title, record_type, publication_date, publication_date_precision, publisher, edition, volume, issue_number, pages, metadata, metadata_source, metadata_fetched_at,
             identifiers ( scheme, normalized_value ),
             record_contributors ( contributor_id, role, position, credited_as,
               contributors ( display_name, kind, family_name, given_names, particle, suffix ) ),
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
