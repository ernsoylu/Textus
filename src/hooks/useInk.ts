import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { deleteAnnotations, inkDataSchema, saveAnnotation, type AnnotationItem, type InkData } from '@/hooks/useAnnotations';
import type { InkStroke } from '@/components/reader/types';

type Action = { kind: 'add' | 'erase'; strokes: InkStroke[] };
export type InkStatus = 'idle' | 'saving' | 'saved' | 'error';

// FR-READ-10/12: ink strokes of one PDF asset, one annotation row per stroke. Every change is an idempotent
// server operation (upsert by client ID, delete by ID) run in order; undo/redo are whole user actions, so undoing
// an erase restores every stroke it removed, and undo after a save is persisted too. A failed operation keeps
// the stroke on screen (dashed) and in the retry list until it succeeds — nothing is dropped silently. Strokes
// are kept only in this tab until saved; there is no offline outbox (FR-READ-14).
export function useInk(recordId: string, assetId: string, rows: AnnotationItem[] | undefined) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [unsaved, setUnsaved] = useState<Map<string, InkStroke>>(new Map());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [undoStack, setUndoStack] = useState<Action[]>([]);
  const [redoStack, setRedoStack] = useState<Action[]>([]);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<{ op: () => Promise<void>; message: string }[]>([]);
  const [everSaved, setEverSaved] = useState(false);
  const queue = useRef(Promise.resolve());

  const run = useCallback((op: () => Promise<void>) => {
    setPending((n) => n + 1);
    queue.current = queue.current
      .then(op)
      .then(
        () => {
          setEverSaved(true);
          void queryClient.invalidateQueries({ queryKey: ['annotations'] });
        },
        (e: unknown) => {
          const message = e instanceof Error ? e.message : 'Could not save.';
          setFailed((f) => [...f, { op, message: navigator.onLine ? message : 'You’re offline.' }]);
        },
      )
      .finally(() => setPending((n) => n - 1));
  }, [queryClient]);

  const persistAdd = useCallback((strokes: InkStroke[]) => {
    setUnsaved((m) => new Map([...m, ...strokes.map((s) => [s.id, { ...s, unsaved: true }] as const)]));
    setHidden((h) => new Set([...h].filter((id) => !strokes.some((s) => s.id === id))));
    run(async () => {
      for (const s of strokes) await saveAnnotation({ id: s.id, recordId, assetId, anchor: { anchor_type: 'pdf_ink', anchor_data: s.data }, color: s.color ?? 'black', text: s.text || undefined }, session!.user.id);
      setUnsaved((m) => {
        const next = new Map(m);
        for (const s of strokes) next.delete(s.id);
        return next;
      });
    });
  }, [run, recordId, assetId, session]);

  const persistErase = useCallback((strokes: InkStroke[]) => {
    const ids = strokes.map((s) => s.id);
    setHidden((h) => new Set([...h, ...ids]));
    run(() => deleteAnnotations(ids));
  }, [run]);

  const apply = useCallback((a: Action, forward: boolean) => (a.kind === 'add') === forward ? persistAdd(a.strokes) : persistErase(a.strokes), [persistAdd, persistErase]);

  const saved = useMemo(() => (rows ?? []).flatMap((a): InkStroke[] => {
    if (a.anchor_type !== 'pdf_ink') return [];
    const data = inkDataSchema.safeParse(a.anchor_data);
    return data.success ? [{ id: a.id, data: data.data, color: a.color, text: a.highlighted_text }] : [];
  }), [rows]);

  const strokes = useMemo(() => {
    const byId = new Map(saved.map((s) => [s.id, s]));
    for (const [id, s] of unsaved) byId.set(id, s);
    return [...byId.values()].filter((s) => !hidden.has(s.id));
  }, [saved, unsaved, hidden]);

  const add = useCallback((data: InkData, color: string, text?: string) => {
    const stroke: InkStroke = { id: crypto.randomUUID(), data, color, text: data.tool === 'highlighter' ? text || null : null };
    setUndoStack((u) => [...u, { kind: 'add', strokes: [stroke] }]);
    setRedoStack([]);
    persistAdd([stroke]);
  }, [persistAdd]);

  const erase = useCallback((ids: string[]) => {
    const gone = strokes.filter((s) => ids.includes(s.id));
    if (!gone.length) return;
    setUndoStack((u) => [...u, { kind: 'erase', strokes: gone }]);
    setRedoStack([]);
    persistErase(gone);
  }, [strokes, persistErase]);

  const undo = useCallback(() => {
    const a = undoStack.at(-1);
    if (!a) return;
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r, a]);
    apply(a, false);
  }, [undoStack, apply]);

  const redo = useCallback(() => {
    const a = redoStack.at(-1);
    if (!a) return;
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, a]);
    apply(a, true);
  }, [redoStack, apply]);

  const retry = useCallback(() => {
    const ops = failed;
    setFailed([]);
    for (const f of ops) run(f.op);
  }, [failed, run]);

  let status: InkStatus;
  if (failed.length) {
    status = 'error';
  } else if (pending) {
    status = 'saving';
  } else if (everSaved) {
    status = 'saved';
  } else {
    status = 'idle';
  }
  return { strokes, add, erase, undo, redo, retry, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, status, error: failed[0]?.message ?? null, unsavedCount: unsaved.size + failed.length };
}
