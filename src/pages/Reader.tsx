import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useAsset } from '@/hooks/useAsset';
import { useUploadAsset } from '@/hooks/useUploadAsset';
import { useFullscreen } from '@/hooks/useFullscreen';
import { useOnline } from '@/hooks/useOnline';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { useReaderPrefs } from '@/hooks/useReaderPrefs';
import { useInk } from '@/hooks/useInk';
import { useReadingState, useProgressSaver, useSaveReadingState, READING_STATUSES, type ReadingStatus, type Progress } from '@/hooks/useReadingState';
import { anchorSchema, highlightFill, isDrawing, useAnnotations, useCreateAnnotation, type Anchor, type AnnotationItem, type InkData } from '@/hooks/useAnnotations';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { isTypingTarget } from '@/lib/keyboard';
import { isBookFormat } from '@/lib/formats';
import { PdfViewer } from '@/components/reader/PdfViewer';
import { BookViewer } from '@/components/reader/BookViewer';
import { DjvuViewer } from '@/components/reader/DjvuViewer';
import { AnnotationForm } from '@/components/reader/AnnotationForm';
import { AnnotationPanel } from '@/components/reader/AnnotationPanel';
import { InkToolbar, INK_WIDTHS } from '@/components/reader/InkToolbar';
import { NoteCard } from '@/components/reader/NoteCard';
import { SelectionMenu } from '@/components/reader/SelectionMenu';
import { Sheet } from '@/components/reader/Sheet';
import type { InkSettings, Point, ViewerAnnotation, ViewerSelection } from '@/components/reader/types';
import { DownloadButton } from '@/components/library/DownloadButton';
import { UnsavedChangesGuard } from '@/components/ui/UnsavedChangesGuard';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Popover } from '@/components/ui/Popover';
import { Button } from '@/components/ui/button';

type Bubble = { at: Point } & ({ id: string } | { draft: ViewerSelection });

// Stands in for the selection being highlighted or commented on (see `pending` below); never saved or opened.
const PENDING_ID = 'pending-selection';
const BTN = 'min-h-11 min-w-11 px-3 py-1';

const parseAnchor = (a: AnnotationItem) => anchorSchema.safeParse({ anchor_type: a.anchor_type, anchor_data: a.anchor_data });
const message = (e: unknown) => (navigator.onLine ? (e instanceof Error ? e.message : 'Could not save.') : 'You’re offline.');

// The reader draws under the iPhone notch / home indicator only while open; safe-area padding keeps its controls clear.
function useViewportFitCover() {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta) return;
    const before = meta.content;
    meta.content = `${before}, viewport-fit=cover`;
    return () => {
      meta.content = before;
    };
  }, []);
}

// FR-READ-1/2/6 viewers, FR-READ-3 progress + status, FR-READ-4/5 annotations, FR-READ-7–12 (M7) touch reading.
// The page owns the reading shell, outside the library chrome: focus mode (F), the notes panel (a bottom sheet
// on narrow screens), selection actions (right-click menu, or a bottom bar after a touch selection), comment
// bubbles, PDF Mark mode with ink, and every write; the viewers only draw and report positions.
// ?annotation=<id> opens a note.
export function Reader() {
  const { workId, recordId, assetId } = useParams<{ workId: string; recordId: string; assetId: string }>();
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('annotation');
  const { data: asset, isLoading, error } = useAsset(assetId);
  const state = useReadingState(recordId);
  const annotations = useAnnotations(assetId);
  const createAnnotation = useCreateAnnotation();
  const saveState = useSaveReadingState(recordId!);
  const uploadAsset = useUploadAsset(recordId!);
  const saveProgress = useProgressSaver(recordId!, assetId!, state.data?.status as ReadingStatus | undefined);
  const ink = useInk(recordId!, assetId!, annotations.data);
  const [prefs, updatePrefs] = useReaderPrefs();
  const online = useOnline();
  const wide = useMediaQuery('(min-width: 768px)');
  const coarse = useMediaQuery('(pointer: coarse)');
  const keyboardInset = useKeyboardInset();
  const shellRef = useRef<HTMLDivElement>(null);
  const notesButtonRef = useRef<HTMLButtonElement>(null);
  const [focus, toggleFocus] = useFullscreen(shellRef);
  const capturedRef = useRef(false);
  const focusedRef = useRef<string | null>(null);
  const opRef = useRef<{ key: string; id: string } | null>(null);
  const [notesOpen, setNotesOpen] = useState(() => globalThis.innerWidth >= 1280);
  const [marking, setMarking] = useState(false);
  const [page, setPage] = useState<number>();
  const [selection, setSelection] = useState<ViewerSelection | null>(null);
  const [menuAt, setMenuAt] = useState<Point | null>(null);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [highlightError, setHighlightError] = useState<string | null>(null);
  // The selection the notes form took focus from; the browser drops its own selection then.
  const [held, setHeld] = useState<ViewerSelection | null>(null);
  const [goTo, setGoTo] = useState<{ anchor: Anchor }>();
  useViewportFitCover();

  const handleFirstPageRendered = useCallback(
    async (canvas: HTMLCanvasElement) => {
      if (capturedRef.current || !recordId) return;
      capturedRef.current = true;
      // §15 Q2's client-side thumbnail path: only capture once per record (skip if a cover exists).
      const { data: existingCover } = await supabase.from('record_assets').select('asset_id').eq('record_id', recordId).eq('role', 'cover').maybeSingle();
      if (existingCover) return;
      canvas.toBlob((blob) => {
        if (!blob) return;
        uploadAsset.mutate({ role: 'cover', file: new File([blob], 'cover.png', { type: 'image/png' }) });
      }, 'image/png');
    },
    [recordId, uploadAsset],
  );

  const handleProgress = useCallback(
    (p: Progress) => {
      if (p.page) setPage(p.page);
      saveProgress(p);
    },
    [saveProgress],
  );

  const handleSelect = useCallback((s: ViewerSelection | null) => {
    setSelection(s);
    setHighlightError(null);
  }, []);

  // Focusing a comment box clears the document's text selection, so the viewers draw the selection being
  // commented on like a highlight until it is saved or dismissed.
  const pending = bubble && 'draft' in bubble ? bubble.draft : held && held === selection ? held : null;
  const viewerAnnotations = useMemo<ViewerAnnotation[]>(
    () => [
      ...(annotations.data ?? []).flatMap((a) => {
        const anchor = parseAnchor(a);
        return anchor.success && anchor.data.anchor_type !== 'pdf_ink' ? [{ id: a.id, anchor: anchor.data, color: highlightFill(a.color), note: a.note }] : [];
      }),
      ...(pending ? [{ id: PENDING_ID, anchor: pending.anchor, color: highlightFill('blue'), note: null }] : []),
    ],
    [annotations.data, pending],
  );

  const openAnnotation = useCallback((id: string, at: Point) => {
    if (id === PENDING_ID) return;
    setMenuAt(null);
    setBubble({ id, at });
  }, []);
  const openMenu = useCallback((at: Point) => {
    setBubble(null);
    setMenuAt(at);
  }, []);

  // Where a note opened from elsewhere (the Notes page, the side panel) shows its bubble: top right of the book.
  const bubbleHome = useCallback((): Point => {
    const box = shellRef.current?.getBoundingClientRect();
    return box ? { x: box.right - (notesOpen && wide ? 700 : 360), y: box.top + 96 } : { x: 80, y: 120 };
  }, [notesOpen, wide]);

  const handleGoTo = useCallback(
    (a: AnnotationItem, withBubble = false) => {
      const anchor = parseAnchor(a);
      if (!anchor.success) return;
      setGoTo({ anchor: anchor.data });
      if (withBubble && !isDrawing(a)) setBubble({ id: a.id, at: bubbleHome() });
      if (!wide) setNotesOpen(false);
    },
    [bubbleHome, wide],
  );

  useEffect(() => {
    const a = focusId && focusedRef.current !== focusId ? annotations.data?.find((x) => x.id === focusId) : undefined;
    if (!a) return;
    focusedRef.current = focusId;
    handleGoTo(a, true);
  }, [focusId, annotations.data, handleGoTo]);

  const { undo, redo } = ink;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (marking && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'f' || (e.key === 'Escape' && focus && !document.fullscreenElement)) {
        e.preventDefault();
        toggleFocus();
      }
    }
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [toggleFocus, focus, marking, undo, redo]);

  // FR-READ-12: one client ID per anchor until it saves, so a retry after a lost response updates, not duplicates.
  function opIdFor(anchor: Anchor) {
    const key = JSON.stringify(anchor);
    if (opRef.current?.key !== key) opRef.current = { key, id: crypto.randomUUID() };
    return opRef.current.id;
  }

  // Menus, bubbles and the selection stay until the save succeeds; on failure the reason shows beside them.
  async function highlight(color: string, note?: string, from = selection) {
    if (!from || !recordId || !assetId) return;
    setHighlightError(null);
    try {
      await createAnnotation.mutateAsync({ id: opIdFor(from.anchor), recordId, assetId, anchor: from.anchor, text: from.text, color, note });
    } catch (e) {
      setHighlightError(message(e));
      throw e;
    }
    opRef.current = null;
    setSelection(null);
    setMenuAt(null);
    setBubble(null);
    setDraftDirty(false);
    document.getSelection()?.removeAllRanges();
  }

  async function addPageNote(color: string, note: string) {
    if (!page || !recordId || !assetId) return;
    const anchor: Anchor = { anchor_type: 'pdf_page', anchor_data: { page } };
    await createAnnotation.mutateAsync({ id: opIdFor(anchor), recordId, assetId, anchor, color, note });
    opRef.current = null;
  }

  function toggleNotes() {
    setNotesOpen((o) => {
      if (o) notesButtonRef.current?.focus();
      return !o;
    });
  }

  // A comment with text is never thrown away by a stray tap, Esc or Close: discarding it is confirmed.
  const closeDraft = () => (draftDirty ? setConfirmDiscard(true) : setBubble(null));

  if (isLoading || state.isLoading) return <p className="p-4 text-body text-muted">Loading…</p>;
  if (error) return <p className="p-4 text-body text-red">Could not load this file: {error.message}</p>;
  if (!asset || !recordId || !assetId) return null;

  const saved = state.data;
  // Resume only when the saved position belongs to this asset (a record can have PDF and EPUB).
  const resume = saved?.asset_id === assetId ? saved : null;
  const format = asset.file_format;
  const isPdf = format === 'pdf';
  const isDjvu = format === 'djvu';
  const isBook = isBookFormat(format);
  const readable = isPdf || isDjvu || isBook;
  const pageFormat = isPdf || isDjvu;
  const bubbleNote = bubble && 'id' in bubble ? annotations.data?.find((a) => a.id === bubble.id) : undefined;
  const startPage = Math.max(1, Math.floor(Number(searchParams.get('page')) || resume?.current_page || 1));
  const inkSettings: InkSettings | null = isPdf && marking
    ? {
        tool: prefs.inkTool,
        color: prefs.inkTool === 'highlighter' ? prefs.highlighterColor : prefs.penColor,
        width: INK_WIDTHS[prefs.inkTool === 'highlighter' ? 'highlighter' : 'pen'][prefs.inkSize],
        fingerDraw: prefs.fingerDraw,
      }
    : null;
  const common = {
    storagePath: asset.storage_path,
    annotations: viewerAnnotations,
    goTo,
    focus,
    onSelect: handleSelect,
    onContextMenu: openMenu,
    onOpenAnnotation: openAnnotation,
    onProgress: handleProgress,
  };
  const showBar = !!selection && !menuAt && !bubble && !marking && (coarse || !wide) && !(notesOpen && !wide);

  const notes = (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-label text-fg">Notes</h2>
        <Button variant="ghost" className={cn(BTN, 'xl:hidden')} onClick={toggleNotes}>Close</Button>
      </div>
      {selection && (
        <div onFocus={() => setHeld(selection)}>
          <AnnotationForm label="Highlight selection" quote={selection.text} notice={selection.notice} onCancel={() => setSelection(null)} onSubmit={(color, note) => highlight(color, note)} />
        </div>
      )}
      {pageFormat && page && !selection && <AnnotationForm label={`Add note to page ${page}`} onSubmit={addPageNote} />}
      <AnnotationPanel items={annotations.data ?? []} onGoTo={(a) => handleGoTo(a)} />
    </>
  );

  return (
    <div
      ref={shellRef}
      className="fixed inset-0 z-30 flex flex-col gap-2 bg-bg pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))]"
    >
      <UnsavedChangesGuard dirty={ink.unsavedCount > 0} subject="drawing" />
      {!focus && (
        <header className="flex flex-wrap items-center gap-1">
          <Link to={`/library/${workId}`} aria-label="Back to details" className="flex min-h-11 items-center rounded-8 px-3 text-small text-fg hover:bg-raised">← Details</Link>
          {!online && <span role="status" className="rounded-4 bg-yellow-bg px-2 py-1 text-small text-yellow">Offline — changes can’t be saved</span>}
          <span className="flex-1" />
          {isPdf && (
            <Button variant={marking ? 'secondary' : 'ghost'} className={BTN} aria-pressed={marking} onClick={() => { setMarking((m) => !m); setMenuAt(null); setSelection(null); }} title="Draw and highlight with Apple Pencil, mouse or finger">
              ✎ Mark
            </Button>
          )}
          {readable && (
            <Button ref={notesButtonRef} variant={notesOpen ? 'secondary' : 'ghost'} className={BTN} aria-pressed={notesOpen} aria-expanded={notesOpen} onClick={toggleNotes}>
              Notes{annotations.data?.length ? ` (${annotations.data.filter((a) => !isDrawing(a)).length})` : ''}
            </Button>
          )}
          <details className="relative">
            <summary className={cn(BTN, 'flex cursor-pointer list-none items-center rounded-8 text-label text-fg hover:bg-raised/60')}>More</summary>
            <div className="absolute right-0 z-40 mt-1 flex w-72 flex-col gap-3 rounded-8 border border-border bg-raised p-3 shadow-lg">
              <label className="flex items-center justify-between gap-2 text-small text-fg">
                Status
                <select
                  aria-label="Reading status"
                  className="min-h-11 rounded-4 border border-muted bg-dim pl-2 text-small text-fg"
                  value={saved?.status ?? 'unread'}
                  onChange={(e) => saveState.mutate({ status: e.target.value as ReadingStatus })}
                >
                  {READING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              {resume && <p className="text-small text-muted">{Math.round(Number(resume.progress_percentage))}% read</p>}
              <DownloadButton bucket={asset.bucket} storagePath={asset.storage_path} />
              <p className="text-small text-muted">Keys: F focus · ← → pages · + − zoom{isPdf ? ' · 0 fit width' : ''}</p>
            </div>
          </details>
          {readable && (
            <Button variant="ghost" className={BTN} aria-pressed={focus} onClick={toggleFocus} title="Focus (F)">⛶ Focus</Button>
          )}
        </header>
      )}
      {focus && (
        <Button variant="secondary" className={cn(BTN, 'fixed right-[max(0.5rem,env(safe-area-inset-right))] top-[max(0.5rem,env(safe-area-inset-top))] z-40 opacity-80 shadow hover:opacity-100 focus-visible:opacity-100')} onClick={toggleFocus}>
          Exit focus
        </Button>
      )}
      {inkSettings && (
        <InkToolbar
          prefs={prefs}
          update={updatePrefs}
          status={ink.status}
          error={ink.error}
          unsaved={ink.unsavedCount}
          canUndo={ink.canUndo}
          canRedo={ink.canRedo}
          onUndo={ink.undo}
          onRedo={ink.redo}
          onRetry={ink.retry}
          onDone={() => setMarking(false)}
        />
      )}

      <main id="main-content" className="relative flex min-h-0 flex-1 gap-3">
        <div className="min-w-0 flex-1">
          {isPdf && (
            <PdfViewer
              {...common}
              initialPage={startPage}
              onFirstPageRendered={handleFirstPageRendered}
              ink={{ strokes: ink.strokes, settings: inkSettings, onStroke: (data: InkData, text?: string) => ink.add(data, inkSettings?.color ?? 'black', text), onErase: ink.erase }}
            />
          )}
          {isDjvu && <DjvuViewer {...common} initialPage={startPage} onFirstPageRendered={handleFirstPageRendered} />}
          {isBook && <BookViewer {...common} format={format} initialCfi={searchParams.get('cfi') ?? (resume?.current_position as { cfi?: string } | null)?.cfi} />}
          {!readable && (
            <div className="flex items-center gap-3">
              <p className="text-body text-muted">In-browser reading isn't available for {format} files.</p>
              <DownloadButton bucket={asset.bucket} storagePath={asset.storage_path} />
            </div>
          )}
        </div>

        {/* Always mounted (hidden when closed), so a half-written note survives closing the panel. */}
        {readable && (
          <aside
            aria-label="Notes"
            hidden={!notesOpen || focus}
            className={cn((!notesOpen || focus) && '!hidden', "fixed inset-x-0 bottom-0 z-40 flex max-h-[75dvh] flex-col gap-3 overflow-auto rounded-t-[16px] border border-border bg-bg p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-xl md:absolute md:inset-x-auto md:inset-y-0 md:right-0 md:z-30 md:max-h-none md:w-[min(22rem,100%)] md:rounded-8 md:pb-3 xl:static xl:z-auto xl:w-80 xl:shrink-0 xl:shadow-none")}
            style={wide ? undefined : { bottom: keyboardInset }}
          >
            {notes}
          </aside>
        )}
      </main>

      {menuAt && selection && (
        <Popover at={menuAt} label="Selected text" role="menu" onClose={() => setMenuAt(null)}>
          <SelectionMenu
            quote={selection.text}
            notice={selection.notice}
            busy={createAnnotation.isPending}
            error={highlightError}
            onHighlight={(color) => void highlight(color).catch(() => undefined)}
            onComment={() => {
              setBubble({ draft: selection, at: menuAt });
              setMenuAt(null);
            }}
            onCopy={() => {
              void navigator.clipboard?.writeText(selection.text);
              setMenuAt(null);
            }}
          />
        </Popover>
      )}
      {showBar && selection && (
        <div role="menu" aria-label="Selected text" className="fixed inset-x-2 z-40 mx-auto max-w-xl rounded-8 border border-border bg-raised p-1 shadow-xl" style={{ bottom: `calc(max(0.5rem, env(safe-area-inset-bottom)) + ${keyboardInset}px)` }}>
          <SelectionMenu
            bar
            quote={selection.text}
            notice={selection.notice}
            busy={createAnnotation.isPending}
            error={highlightError}
            onHighlight={(color) => void highlight(color).catch(() => undefined)}
            onComment={() => setBubble({ draft: selection, at: { x: 8, y: globalThis.innerHeight } })}
            onCopy={() => void navigator.clipboard?.writeText(selection.text)}
          />
        </div>
      )}
      {bubble && 'draft' in bubble && (wide ? (
        <Popover at={bubble.at} label="New comment" onClose={closeDraft}>
          <AnnotationForm label="Save comment" quote={bubble.draft.text} notice={bubble.draft.notice} autoFocus onDirtyChange={setDraftDirty} onCancel={() => { setDraftDirty(false); setBubble(null); }} onSubmit={(color, note) => highlight(color, note, bubble.draft)} />
        </Popover>
      ) : (
        <Sheet label="New comment" onClose={closeDraft}>
          <AnnotationForm label="Save comment" quote={bubble.draft.text} notice={bubble.draft.notice} autoFocus onDirtyChange={setDraftDirty} onCancel={() => { setDraftDirty(false); setBubble(null); }} onSubmit={(color, note) => highlight(color, note, bubble.draft)} />
        </Sheet>
      ))}
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this comment?"
        description="The comment you wrote has not been saved."
        confirmLabel="Discard"
        onConfirm={() => {
          setConfirmDiscard(false);
          setDraftDirty(false);
          setBubble(null);
        }}
        onClose={() => setConfirmDiscard(false)}
      />
      {bubbleNote && bubble && (wide ? (
        <Popover at={bubble.at} label="Comment" onClose={() => setBubble(null)}>
          <NoteCard a={bubbleNote} inBook autoFocus={!bubbleNote.note} onDeleted={() => setBubble(null)} />
        </Popover>
      ) : (
        <Sheet label="Comment" onClose={() => setBubble(null)}>
          <NoteCard a={bubbleNote} inBook autoFocus={!bubbleNote.note} onDeleted={() => setBubble(null)} />
        </Sheet>
      ))}
    </div>
  );
}
