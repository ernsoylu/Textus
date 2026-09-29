import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import { supabase } from '@/lib/supabase';
import { isTypingTarget } from '@/lib/keyboard';
import { Button } from '@/components/ui/button';
import type { PageRect } from '@/hooks/useAnnotations';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfHighlight {
  id: string;
  page: number;
  rects: PageRect[];
  color: string;
}

export interface PdfSelection {
  page: number;
  text: string;
  rects: PageRect[];
}

// FR-READ-1/4. Files are private (invariant 7): always a short-lived signed URL, never
// getPublicUrl(). §9.3 step 1 — this loads whichever asset the caller resolved.
// A pdf.js text layer sits over the canvas so text can be selected; a selection is reported as
// page-relative rectangles (0–1) that stay correct at any zoom.
export interface PdfViewerProps {
  bucket: 'documents';
  storagePath: string;
  initialPage?: number;
  goToPage?: number;
  highlights?: PdfHighlight[];
  onSelect?: (selection: PdfSelection) => void;
  onPageChange?: (page: number, pageCount: number) => void;
  onFirstPageRendered?: (canvas: HTMLCanvasElement) => void;
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

export function PdfViewer({ bucket, storagePath, initialPage = 1, goToPage, highlights = [], onSelect, onPageChange, onFirstPageRendered }: Readonly<PdfViewerProps>) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const taskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const capturedFirstPage = useRef(false);
  // Callbacks change identity on every parent render; the page render must not restart because of that.
  const firstPageCallback = useRef(onFirstPageRendered);
  firstPageCallback.current = onFirstPageRendered;
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [pageDraft, setPageDraft] = useState(String(initialPage));
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const goTo = useCallback((n: number) => {
    setPage((current) => (pageCount ? Math.min(Math.max(1, n), pageCount) : current));
  }, [pageCount]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const { data, error: signError } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 300);
      if (signError || !data) throw signError ?? new Error('Could not create a signed URL.');
      const task = pdfjsLib.getDocument({ url: data.signedUrl });
      taskRef.current = task;
      const doc = await task.promise;
      if (cancelled) return;
      docRef.current = doc;
      setPageCount(doc.numPages);
      setLoading(false);
    })().catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      taskRef.current?.destroy();
    };
  }, [bucket, storagePath]);

  useEffect(() => {
    if (goToPage) goTo(goToPage);
  }, [goToPage, goTo]);

  useEffect(() => {
    setPageDraft(String(page));
    if (pageCount) onPageChange?.(page, pageCount);
  }, [page, pageCount, onPageChange]);

  // Keyboard: ←/→ and PageUp/PageDown turn pages, Home/End jump, +/- zoom (NFR-A11Y-1).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const actions: Record<string, () => void> = {
        ArrowRight: () => goTo(page + 1),
        PageDown: () => goTo(page + 1),
        ArrowLeft: () => goTo(page - 1),
        PageUp: () => goTo(page - 1),
        Home: () => goTo(1),
        End: () => goTo(pageCount),
        '+': () => setZoom((z) => Math.min(3, z + 0.25)),
        '=': () => setZoom((z) => Math.min(3, z + 0.25)),
        '-': () => setZoom((z) => Math.max(0.5, z - 0.25)),
      };
      const action = actions[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    }
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [page, pageCount, goTo]);

  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const textContainer = textRef.current;
    if (!doc || !canvas || !textContainer || loading) return;
    let cancelled = false;
    let textLayer: pdfjsLib.TextLayer | null = null;
    let renderTask: pdfjsLib.RenderTask | null = null;
    (async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: zoom });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      renderTask = pdfPage.render({ canvasContext: ctx, viewport, canvas });
      await renderTask.promise;
      if (cancelled) return;
      textContainer.replaceChildren();
      textLayer = new pdfjsLib.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: textContainer, viewport });
      await textLayer.render();
      if (cancelled) return;
      // §15 Q2's proposed thumbnail path: capture page 1 on first render, client-side, rather
      // than a server-side rasterizer (Deno edge functions can't render PDF pages — see
      // supabase/functions/job-worker's generate_thumbnail handling).
      if (page === 1 && !capturedFirstPage.current) {
        capturedFirstPage.current = true;
        firstPageCallback.current?.(canvas);
      }
    })().catch((e: Error) => !cancelled && e.name !== 'AbortException' && e.name !== 'RenderingCancelledException' && setError(e.message));
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [page, zoom, loading]);

  function reportSelection() {
    const selection = document.getSelection();
    const wrap = wrapRef.current;
    const text = selection?.toString().trim();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !wrap || !text || !onSelect) return;
    const range = selection.getRangeAt(0);
    if (!textRef.current?.contains(range.commonAncestorContainer)) return;
    const box = wrap.getBoundingClientRect();
    const rects = [...range.getClientRects()]
      .filter((r) => r.width > 1 && r.height > 1)
      .slice(0, 200)
      .map((r) => ({ x1: round((r.left - box.left) / box.width), y1: round((r.top - box.top) / box.height), x2: round((r.right - box.left) / box.width), y2: round((r.bottom - box.top) / box.height) }));
    if (rects.length) onSelect({ page, text, rects });
  }

  if (error) return <p className="text-body text-red">Could not load this file: {error}</p>;
  if (loading) return <p className="text-body text-muted">Loading…</p>;

  const scaleVars = { '--scale-factor': zoom, '--user-unit': 1, '--total-scale-factor': zoom } as CSSProperties;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => goTo(page - 1)}>
          Previous
        </Button>
        <form
          className="flex items-center gap-1 text-small text-fg"
          onSubmit={(e) => {
            e.preventDefault();
            goTo(Number.parseInt(pageDraft, 10) || page);
          }}
        >
          <label className="flex items-center gap-1">
            Page
            <input
              type="number"
              min={1}
              max={pageCount}
              value={pageDraft}
              onChange={(e) => setPageDraft(e.target.value)}
              onBlur={() => goTo(Number.parseInt(pageDraft, 10) || page)}
              className="w-16 rounded-8 border border-muted bg-dim p-2 text-body text-fg"
            />
          </label>
          of {pageCount}
        </form>
        <Button variant="secondary" disabled={page >= pageCount} onClick={() => goTo(page + 1)}>
          Next
        </Button>
        <Button variant="ghost" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
          Zoom out
        </Button>
        <p className="text-small text-muted">{Math.round(zoom * 100)}%</p>
        <Button variant="ghost" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
          Zoom in
        </Button>
      </div>
      <div className="max-w-full overflow-auto">
        <div ref={wrapRef} className="relative inline-block rounded-8 border border-border" style={scaleVars}>
          <canvas ref={canvasRef} className="block" />
          <div ref={textRef} className="textLayer" onMouseUp={reportSelection} onKeyUp={reportSelection} />
          {highlights
            .filter((h) => h.page === page)
            .flatMap((h) =>
              h.rects.map((r, i) => (
                <span
                  key={`${h.id}:${i}`}
                  aria-hidden="true"
                  className="pointer-events-none absolute"
                  style={{ left: `${r.x1 * 100}%`, top: `${r.y1 * 100}%`, width: `${(r.x2 - r.x1) * 100}%`, height: `${(r.y2 - r.y1) * 100}%`, backgroundColor: h.color, opacity: 0.4, mixBlendMode: 'multiply' }}
                />
              )),
            )}
        </div>
      </div>
    </div>
  );
}
