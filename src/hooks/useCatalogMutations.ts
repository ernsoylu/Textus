import { parseIdentifier, type IdentifierScheme } from 'shared/identifier';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import type { WorkRow, RecordRow } from '@/types';

// FR-CAT-1: update/delete for works and records (create+read live in NewWork/useWorks/useWork).
// RLS already scopes every one of these to the caller (§7.3 works_update_own/delete_own,
// records_update/delete) — no extra ownership check needed here.

type WorkUpdate = Partial<Pick<WorkRow, 'title' | 'subtitle' | 'abstract' | 'language' | 'work_type' | 'user_rating'>>;
type RecordUpdate = Partial<
  Pick<RecordRow, 'record_type' | 'title' | 'publisher' | 'edition' | 'volume' | 'issue_number' | 'pages' | 'publication_date' | 'publication_date_precision'>
>;

export function useUpdateWork(workId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: WorkUpdate) => {
      const { data: current, error: readError } = await supabase.from('works').select('title,subtitle,abstract,language,work_type,user_rating,metadata').eq('id', workId).single();
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
    mutationFn: async ({ recordId, patch, metadataPatch = {} }: { recordId: string; patch: RecordUpdate; metadataPatch?: Record<string, string | null> }) => {
      const { data: current, error: readError } = await supabase.from('records').select('record_type,title,publisher,edition,volume,issue_number,pages,publication_date,publication_date_precision,metadata').eq('id', recordId).single();
      if (readError) throw readError;
      const previous = (current.metadata ?? {}) as Record<string, unknown>;
      const locked = new Set(Array.isArray(previous.locked_fields) ? previous.locked_fields as string[] : []);
      for (const [field, value] of Object.entries(patch)) if (value !== current[field as keyof typeof current]) locked.add(field);
      for (const [field, value] of Object.entries(metadataPatch)) if (value !== (previous[field] ?? null)) locked.add(field);
      const { error } = await supabase.from('records').update({ ...patch, metadata: { ...previous, ...metadataPatch, locked_fields: [...locked] } }).eq('id', recordId);
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

// FR-FILE-4: detach a file from a record. The asset itself is immutable and may be shared through
// deduplication (FR-FILE-3), so only the link goes; the `cleanup` job deletes assets nothing links to.
export function useRemoveAssetLink(workId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ recordId, assetId, role }: { recordId: string; assetId: string; role: string }) => {
      const { error } = await supabase.from('record_assets').delete().eq('record_id', recordId).eq('asset_id', assetId).eq('role', role);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['works', workId] });
      queryClient.invalidateQueries({ queryKey: ['works'] });
    },
  });
}

// FR-CAT-4: remove an identifier from a record (identifiers_delete, RLS).
export function useRemoveIdentifier(workId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ recordId, scheme, value }: { recordId: string; scheme: string; value: string }) => {
      const { error } = await supabase.from('identifiers').delete().eq('record_id', recordId).eq('scheme', scheme).eq('normalized_value', value);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['works', workId] });
      queryClient.invalidateQueries({ queryKey: ['works'] });
    },
  });
}

// FR-RES-2: candidates for "link under the same work" — article versions of *other* works, found by work title.
export function useLinkableRecords(workId: string, search: string) {
  const q = search.trim();
  return useQuery({
    queryKey: ['linkable-records', workId, q],
    enabled: q.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('records')
        .select('id, work_id, publication_date, metadata, works!inner(title), identifiers(scheme, normalized_value)')
        .eq('record_type', 'article_version')
        .neq('work_id', workId)
        .ilike('works.title', `%${q.replaceAll(/[%_]/g, '')}%`)
        .limit(8);
      if (error) throw error;
      return data;
    },
  });
}

// Moves the chosen record under this work and labels it (preprint / published / other). If that leaves its
// old work with no records, the empty work is deleted so the library has no hollow shells. RLS checks that
// the caller owns both works (records_update WITH CHECK).
export function useLinkVersion(workId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ recordId, fromWorkId, version }: { recordId: string; fromWorkId: string; version: string }) => {
      const { data: record, error: readError } = await supabase.from('records').select('metadata').eq('id', recordId).single();
      if (readError) throw readError;
      const metadata = { ...((record.metadata ?? {}) as Record<string, unknown>), version };
      const { error } = await supabase.from('records').update({ work_id: workId, metadata }).eq('id', recordId);
      if (error) throw error;
      const { count, error: countError } = await supabase.from('records').select('id', { count: 'exact', head: true }).eq('work_id', fromWorkId);
      if (countError) throw countError;
      if (count === 0) {
        const { error: deleteError } = await supabase.from('works').delete().eq('id', fromWorkId);
        if (deleteError) throw deleteError;
      }
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

// FR-CAT-4: validate and normalize before writing (shared/identifier.ts, never JSONB).
// FR-CAT-5: warn — not block — when the normalized value is already in the user's library.
export async function addIdentifier(recordId: string, scheme: IdentifierScheme, raw: string) {
  const parsed = parseIdentifier(scheme, raw);
  if (!parsed.ok) {
    throw new Error(parsed.reason === 'invalid_check_digit' ? 'That check digit is not valid.' : 'That does not look like a valid ' + scheme.toUpperCase() + '.');
  }

  const { error: insertError } = await supabase
    .from('identifiers')
    .insert({ record_id: recordId, scheme, normalized_value: parsed.normalized, original_value: parsed.original });
  if (insertError) {
    if (insertError.code === '23505') throw new Error('This record already has that identifier.');
    throw insertError;
  }

  if (parsed.scheme === 'arxiv' && parsed.arxivVersion !== undefined) {
    const { data: record } = await supabase.from('records').select('metadata').eq('id', recordId).single();
    await supabase
      .from('records')
      .update({ metadata: { ...(record?.metadata as object), arxiv_version: parsed.arxivVersion } })
      .eq('id', recordId);
  }

  const { data: existingElsewhere } = await supabase
    .from('identifiers')
    .select('record_id')
    .eq('scheme', scheme)
    .eq('normalized_value', parsed.normalized)
    .neq('record_id', recordId);

  return { duplicateCount: existingElsewhere?.length ?? 0 };
}
