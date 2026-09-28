import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { WorkRow, RecordRow } from '@/types';

// FR-CAT-1: update/delete for works and records (create+read live in NewWork/useWorks/useWork).
// RLS already scopes every one of these to the caller (§7.3 works_update_own/delete_own,
// records_update/delete) — no extra ownership check needed here.

type WorkUpdate = Partial<Pick<WorkRow, 'title' | 'subtitle' | 'work_type'>>;
type RecordUpdate = Partial<
  Pick<RecordRow, 'title' | 'publisher' | 'edition' | 'volume' | 'issue_number' | 'pages' | 'publication_date'>
>;

export function useUpdateWork(workId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: WorkUpdate) => {
      const { error } = await supabase.from('works').update(patch).eq('id', workId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['works'] });
    },
  });
}

export function useDeleteWork() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async (workId: string) => {
      const { error } = await supabase.from('works').delete().eq('id', workId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['works'] });
      navigate('/library');
    },
  });
}

export function useUpdateRecord(workId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ recordId, patch }: { recordId: string; patch: RecordUpdate }) => {
      const { error } = await supabase.from('records').update(patch).eq('id', recordId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['works', workId] });
      queryClient.invalidateQueries({ queryKey: ['works'] });
    },
  });
}

export function useDeleteRecord(workId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (recordId: string) => {
      const { error } = await supabase.from('records').delete().eq('id', recordId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['works', workId] });
      queryClient.invalidateQueries({ queryKey: ['works'] });
    },
  });
}
