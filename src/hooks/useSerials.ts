import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { readExpectedIssues } from '@/lib/serialCompleteness';

// FR-SER-1/2: serial works with their issue records (volume + number) and the expected run, for completeness.
export function useSerials() {
  return useQuery({
    queryKey: ['serials'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('works')
        .select('id, title, metadata, records ( record_type, volume, issue_number )')
        .eq('work_type', 'serial')
        .order('title');
      if (error) throw error;
      return data.map((w) => ({ id: w.id, title: w.title, expected: readExpectedIssues(w.metadata), issues: w.records.filter((r) => r.record_type === 'issue') }));
    },
  });
}

export function useSerial(workId: string | undefined) {
  return useQuery({
    queryKey: ['serials', workId],
    enabled: !!workId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('works')
        .select('id, title, work_type, metadata, records ( id, record_type, volume, issue_number, publication_date, title )')
        .eq('id', workId!)
        .single();
      if (error) throw error;
      return { id: data.id, title: data.title, workType: data.work_type, expected: readExpectedIssues(data.metadata), issues: data.records.filter((r) => r.record_type === 'issue') };
    },
  });
}

// Read-modify-write on works.metadata so locked_fields and other keys survive. An empty run removes the volume.
export function useSetExpectedIssues(workId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ volume, run }: { volume: string; run: string }) => {
      const { data, error } = await supabase.from('works').select('metadata').eq('id', workId).single();
      if (error) throw error;
      const metadata = (data.metadata ?? {}) as Record<string, unknown>;
      const expected = { ...readExpectedIssues(metadata) };
      if (run.trim()) expected[volume.trim()] = run.trim();
      else delete expected[volume.trim()];
      const { error: updateError } = await supabase.from('works').update({ metadata: { ...metadata, expected_issues: expected } as never }).eq('id', workId);
      if (updateError) throw updateError;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['serials'] }),
  });
}
