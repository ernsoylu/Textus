import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { WorkRow, RecordRow } from '@/types';

// FR-CAT-1: update/delete for works and records (create+read live in NewWork/useWorks/useWork).
// RLS already scopes every one of these to the caller (§7.3 works_update_own/delete_own,
// records_update/delete) — no extra ownership check needed here.

type WorkUpdate = Partial<Pick<WorkRow, 'title' | 'subtitle' | 'abstract' | 'language' | 'work_type'>>;
type RecordUpdate = Partial<
  Pick<RecordRow, 'title' | 'publisher' | 'edition' | 'volume' | 'issue_number' | 'pages' | 'publication_date' | 'publication_date_precision'>
>;

export function useUpdateWork(workId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: WorkUpdate) => {
      const { data: current, error: readError } = await supabase.from('works').select('title,subtitle,abstract,language,work_type,metadata').eq('id', workId).single();
      if (readError) throw readError;
      const previous = (current?.metadata ?? {}) as Record<string, unknown>;
      const locked = new Set(Array.isArray(previous.locked_fields) ? previous.locked_fields as string[] : []);
      for (const [field, value] of Object.entries(patch)) if (value !== current[field as keyof typeof current]) locked.add(field);
      const { error } = await supabase.from('works').update({ ...patch, metadata: { ...previous, locked_fields: [...locked] } } as never).eq('id', workId);
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
      const { data: current, error: readError } = await supabase.from('records').select('title,publisher,edition,volume,issue_number,pages,publication_date,publication_date_precision,metadata').eq('id', recordId).single();
      if (readError) throw readError;
      const previous = (current.metadata ?? {}) as Record<string, unknown>;
      const locked = new Set(Array.isArray(previous.locked_fields) ? previous.locked_fields as string[] : []);
      for (const [field, value] of Object.entries(patch)) if (value !== current[field as keyof typeof current]) locked.add(field);
      const { error } = await supabase.from('records').update({ ...patch, metadata: { ...previous, locked_fields: [...locked] } }).eq('id', recordId);
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

// FR-RES-2 / FR-SER-1: extra records under an existing work — a preprint or published version of
// an article, or an issue of a serial. RLS (records_insert) checks the caller owns the work.
interface NewRecord {
  record_type: 'article_version' | 'issue' | 'edition';
  title?: string;
  volume?: string;
  issue_number?: string;
  publication_date?: string;
  publication_date_precision?: 'day';
  metadata?: Record<string, string>;
}

export function useAddRecord(workId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (record: NewRecord) => {
      const { error } = await supabase.from('records').insert({ work_id: workId, ...record });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['works'] });
      queryClient.invalidateQueries({ queryKey: ['serials'] });
    },
  });
}

// FR-CONTRIB-10: point a chapter/article record at its container record (edited volume or issue).
export function useSetContainer(workId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ recordId, containerId }: { recordId: string; containerId: string | null }) => {
      const { error } = await supabase.from('records').update({ container_record_id: containerId }).eq('id', recordId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['works', workId] }),
  });
}
