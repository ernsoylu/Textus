import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import type { Json } from '@/types/database';

export const READING_STATUSES = ['unread', 'reading', 'finished', 'abandoned'] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];

// FR-READ-3: progress and status live in reading_states (one row per user+record), so any
// device that opens the record resumes from the server copy.
export function useReadingState(recordId: string | undefined) {
  return useQuery({
    queryKey: ['reading-state', recordId],
    enabled: !!recordId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reading_states')
        .select('asset_id, progress_percentage, current_page, current_position, status')
        .eq('record_id', recordId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

interface StatePatch {
  asset_id?: string;
  progress_percentage?: number;
  current_page?: number;
  current_position?: Json;
  status?: ReadingStatus;
  last_read_at?: string;
}

// The upsert only touches the supplied columns, so a status change never clobbers progress.
export function useSaveReadingState(recordId: string) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: async (patch: StatePatch) => {
      const { error } = await supabase
        .from('reading_states')
        .upsert({ user_id: session!.user.id, record_id: recordId, ...patch }, { onConflict: 'user_id,record_id' });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reading-state', recordId] }),
  });
}

export interface Progress {
  percentage: number;
  page?: number;
  position: Json;
}

// Debounced (~5 s, §9.3) progress saver; flushes on unmount so the last position is not lost.
// Status moves unread → reading on first progress and → finished at 100%; a manual choice
// (abandoned, or reverting to reading) is otherwise left alone.
export function useProgressSaver(recordId: string, assetId: string, status: ReadingStatus | undefined) {
  const { mutate } = useSaveReadingState(recordId);
  const pending = useRef<Progress | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const statusRef = useRef(status);
  statusRef.current = status;

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const current = statusRef.current ?? 'unread';
    let next: ReadingStatus = current;
    if (p.percentage >= 100 && current !== 'abandoned') next = 'finished';
    else if (current === 'unread') next = 'reading';
    mutate({
      asset_id: assetId,
      progress_percentage: Math.min(100, Math.max(0, Math.round(p.percentage * 100) / 100)),
      current_page: p.page,
      current_position: p.position,
      status: next,
      last_read_at: new Date().toISOString(),
    });
  }, [mutate, assetId]);

  useEffect(() => flush, [flush]);

  return useCallback(
    (p: Progress) => {
      pending.current = p;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 5000);
    },
    [flush],
  );
}
