import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useAsset } from '@/hooks/useAsset';
import { useUploadAsset } from '@/hooks/useUploadAsset';
import { useFullscreen } from '@/hooks/useFullscreen';
import { useReadingState, useProgressSaver, useSaveReadingState, READING_STATUSES, type ReadingStatus, type Progress } from '@/hooks/useReadingState';
import { anchorSchema, highlightFill, useAnnotations, useCreateAnnotation, type Anchor, type AnnotationItem } from '@/hooks/useAnnotations';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { isTypingTarget } from '@/lib/keyboard';
import { isBookFormat } from '@/lib/formats';
import { PdfViewer } from '@/components/reader/PdfViewer';
import { BookViewer } from '@/components/reader/BookViewer';
import { DjvuViewer } from '@/components/reader/DjvuViewer';
import { AnnotationForm } from '@/components/reader/AnnotationForm';
import { AnnotationPanel } from '@/components/reader/AnnotationPanel';
import { NoteCard } from '@/components/reader/NoteCard';
import { SelectionMenu } from '@/components/reader/SelectionMenu';
import type { Point, ViewerAnnotation, ViewerSelection } from '@/components/reader/types';
import { DownloadButton } from '@/components/library/DownloadButton';
import { Popover } from '@/components/ui/Popover';
import { Button } from '@/components/ui/button';

type Bubble = { at: Point } & ({ id: string } | { draft: ViewerSelection });

// Stands in for the selection being highlighted or commented on (see `pending` below); never saved or opened.
const PENDING_ID = 'pending-selection';

const parseAnchor = (a: AnnotationItem) => anchorSchema.safeParse({ anchor_type: a.anchor_type, anchor_data: a.anchor_data });

// FR-READ-1/2/6 viewers, FR-READ-3 progress + status, FR-READ-4/5 annotations. The page owns the reading shell:
// fullscreen (F), the notes panel, the right-click menu for selected text and the comment bubbles that open
// from a highlight's marker; the viewers only draw and report positions. ?annotation=<id> opens a note.
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
  const shellRef = useRef<HTMLDivElement>(null);
  const [fullscreen, toggleFullscreen] = useFullscreen(shellRef);
  const capturedRef = useRef(false);
  const focusedRef = useRef<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(() => globalThis.innerWidth >= 1280);
  const [page, setPage] = useState<number>();
  const [selection, setSelection] = useState<ViewerSelection | null>(null);
  const [menuAt, setMenuAt] = useState<Point | null>(null);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  // The selection the notes form took focus from; the browser drops its own selection then.
  const [held, setHeld] = useState<ViewerSelection | null>(null);
  const [goTo, setGoTo] = useState<{ anchor: Anchor }>();

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

  // Focusing a comment box clears the document's text selection, so the viewers draw the selection being
  // commented on like a highlight until it is saved or dismissed.
  const pending = bubble && 'draft' in bubble ? bubble.draft : held && held === selection ? held : null;
  const viewerAnnotations = useMemo<ViewerAnnotation[]>(
    () => [
      ...(annotations.data ?? []).flatMap((a) => {
        const anchor = parseAnchor(a);
        return anchor.success ? [{ id: a.id, anchor: anchor.data, color: highlightFill(a.color), note: a.note }] : [];
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
    return box ? { x: box.right - (notesOpen ? 700 : 360), y: box.top + 96 } : { x: 80, y: 120 };
  }, [notesOpen]);

  const handleGoTo = useCallback(
    (a: AnnotationItem, withBubble = false) => {
      const anchor = parseAnchor(a);
      if (!anchor.success) return;
      setGoTo({ anchor: anchor.data });
      if (withBubble) setBubble({ id: a.id, at: bubbleHome() });
    },
    [bubbleHome],
  );

  useEffect(() => {
    const a = focusId && focusedRef.current !== focusId ? annotations.data?.find((x) => x.id === focusId) : undefined;
    if (!a) return;
    focusedRef.current = focusId;
    handleGoTo(a, true);
  }, [focusId, annotations.data, handleGoTo]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'f' || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      toggleFullscreen();
    }
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [toggleFullscreen]);

  function highlight(color: string, note?: string, from = selection) {
    if (!from || !recordId || !assetId) return;
    createAnnotation.mutate({ recordId, assetId, anchor: from.anchor, text: from.text, color, note }, {
      onSuccess: () => {
        setSelection(null);
        document.getSelection()?.removeAllRanges();
      },
    });
    setMenuAt(null);
    setBubble(null);
  }

  if (isLoading || state.isLoading) return <p className="text-body text-muted">Loading…</p>;
  if (error) return <p className="text-body text-red">Could not load this file: {error.message}</p>;
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
  const common = {
    storagePath: asset.storage_path,
    annotations: viewerAnnotations,
    goTo,
    onSelect: setSelection,
    onContextMenu: openMenu,
    onOpenAnnotation: openAnnotation,
    onProgress: handleProgress,
  };

  return (
    <div
      ref={shellRef}
      className={cn('flex min-h-[480px] flex-col gap-2 bg-bg', fullscreen ? 'fixed inset-0 z-40 h-dvh p-3' : 'h-[calc(100dvh-13rem)] md:h-[calc(100dvh-8rem)]')}
    >
      <div className="flex flex-wrap items-center gap-2">
        {!fullscreen && <Link to={`/library/${workId}`} className="text-small text-muted underline">Back to details</Link>}
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-small text-fg">
          Status
          <select
            aria-label="Reading status"
            className="rounded-4 border border-muted bg-dim py-1 pl-2 text-small text-fg"
            value={saved?.status ?? 'unread'}
            onChange={(e) => saveState.mutate({ status: e.target.value as ReadingStatus })}
          >
            {READING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {resume && <span className="text-muted">{Math.round(Number(resume.progress_percentage))}%</span>}
        </label>
        {readable && (
          <Button variant={notesOpen ? 'secondary' : 'ghost'} className="min-h-9 px-3 py-1" aria-pressed={notesOpen} onClick={() => setNotesOpen((o) => !o)}>
            Notes{annotations.data?.length ? ` (${annotations.data.length})` : ''}
          </Button>
        )}
        {readable && (
          <Button variant="ghost" className="min-h-9 px-3 py-1" aria-pressed={fullscreen} onClick={toggleFullscreen} title="Full screen (F)">
            {fullscreen ? 'Exit full screen' : '⛶ Full screen'}
          </Button>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 gap-3">
        <div className="min-w-0 flex-1">
          {isPdf && <PdfViewer {...common} initialPage={Math.max(1, Math.floor(Number(searchParams.get('page')) || resume?.current_page || 1))} onFirstPageRendered={handleFirstPageRendered} />}
          {isDjvu && <DjvuViewer {...common} initialPage={Math.max(1, Math.floor(Number(searchParams.get('page')) || resume?.current_page || 1))} onFirstPageRendered={handleFirstPageRendered} />}
          {isBook && <BookViewer {...common} format={format} initialCfi={searchParams.get('cfi') ?? (resume?.current_position as { cfi?: string } | null)?.cfi} />}
          {!readable && (
            <div className="flex items-center gap-3">
              <p className="text-body text-muted">In-browser reading isn't available for {format} files.</p>
              <DownloadButton bucket={asset.bucket} storagePath={asset.storage_path} />
            </div>
          )}
        </div>

        {readable && notesOpen && (
          <aside aria-label="Notes" className="absolute inset-y-0 right-0 z-30 flex w-[min(22rem,100%)] flex-col gap-3 overflow-auto rounded-8 border border-border bg-bg p-3 shadow-xl xl:static xl:z-auto xl:w-80 xl:shrink-0 xl:shadow-none">
            {selection && (
              <div onFocus={() => setHeld(selection)}>
                <AnnotationForm
                  label="Highlight selection"
                  quote={selection.text}
                  isLoading={createAnnotation.isPending}
                  onCancel={() => setSelection(null)}
                  onSubmit={(color, note) => highlight(color, note)}
                />
              </div>
            )}
            {pageFormat && page && !selection && (
              <AnnotationForm
                label={`Add note to page ${page}`}
                isLoading={createAnnotation.isPending}
                onSubmit={(color, note) => createAnnotation.mutate({ recordId, assetId, anchor: { anchor_type: 'pdf_page', anchor_data: { page } }, color, note })}
              />
            )}
            {createAnnotation.error && <p className="text-small text-red">{createAnnotation.error.message}</p>}
            <AnnotationPanel items={annotations.data ?? []} onGoTo={(a) => handleGoTo(a)} />
          </aside>
        )}
      </div>

      {menuAt && selection && (
        <Popover at={menuAt} label="Selected text" role="menu" onClose={() => setMenuAt(null)}>
          <SelectionMenu
            quote={selection.text}
            onHighlight={(color) => highlight(color)}
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
      {bubble && 'draft' in bubble && (
        <Popover at={bubble.at} label="New comment" onClose={() => setBubble(null)}>
          <AnnotationForm label="Save comment" quote={bubble.draft.text} autoFocus isLoading={createAnnotation.isPending} onCancel={() => setBubble(null)} onSubmit={(color, note) => highlight(color, note, bubble.draft)} />
        </Popover>
      )}
      {bubbleNote && bubble && (
        <Popover at={bubble.at} label="Comment" onClose={() => setBubble(null)}>
          <NoteCard a={bubbleNote} inBook autoFocus={!bubbleNote.note} onDeleted={() => setBubble(null)} />
        </Popover>
      )}
    </div>
  );
}
