import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import djvuUrl from '@/vendor/djvu/djvu.js?url';
import { supabase } from '@/lib/supabase';
import { isTypingTarget } from '@/lib/keyboard';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePinchZoom, type PinchCommit } from '@/hooks/usePinchZoom';
import { Button } from '@/components/ui/button';
import { PageOverlay } from './PageOverlay';
import { ReturnButton } from './ReturnButton';
import { Sheet } from './Sheet';
import { TocList } from './TocList';
import { hitTest, textRects, toPageRects } from './pageGeometry';
import type { TocItem, ViewerProps } from './types';

// The slice of DjVu.js (src/vendor/djvu, GPL-2.0-or-later) used here. Its worker proxies calls: a task is
// built from method calls on `doc` and executed by `.run()`, or several at once by `worker.run(...)`.
interface DjVuTask<T> {
  run(): Promise<T>;
}
interface DjVuPageTasks {
  getImageData(): DjVuTask<ImageData>;
  getDpi(): DjVuTask<number>;
  getNormalizedTextZones(): DjVuTask<TextZone[] | null>;
}
interface DjVuWorker {
  createDocument(buffer: ArrayBuffer): Promise<void>;
  run(...tasks: DjVuTask<unknown>[]): Promise<unknown[]>;
  terminate(): void;
  doc: {
    getPagesQuantity(): DjVuTask<number>;
    getContents(): DjVuTask<Bookmark[] | null>;
    getPageNumberByUrl(url: string): DjVuTask<number | null>;
    getPage(n: number): DjVuPageTasks;
  };
}
interface Bookmark {
  description: string;
  url: string;
  children?: Bookmark[];
}
interface TextZone {
  x: number;
  y: number; // from the bottom of the page
  width: number;
  height: number;
  text: string;
}

let library: Promise<{ Worker: new () => DjVuWorker }> | null = null;
// The library is a classic script (an IIFE defining `DjVu`), loaded from this origin on first use.
function loadLibrary() {
  library ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = djvuUrl;
    script.onload = () => resolve((globalThis as unknown as { DjVu: { Worker: new () => DjVuWorker } }).DjVu);
    script.onerror = () => {
      library = null;
      reject(new Error('The DjVu reader could not be loaded.'));
    };
    document.head.append(script);
  });
  return library;
}

const BTN = 'min-h-11 min-w-11 px-2 py-1';
const FIELD = 'min-h-11 rounded-4 border border-muted bg-dim px-2 py-1 text-small text-fg';

const toToc = (items: Bookmark[] | null | undefined): TocItem[] => (items ?? []).map((b) => ({ label: b.description, href: b.url, subitems: toToc(b.children) }));

interface Rendered {
  page: number;
  width: number;
  height: number;
  dpi: number;
  zones: TextZone[];
}

// FR-READ-6. DjVu scans, one page at a time: DjVu.js decodes in a Web Worker, the page image goes on a canvas,
// and the hidden OCR text (when the file has it) becomes a transparent text layer, so text can be selected,
// searched with the browser and highlighted exactly like a PDF (page-relative rectangles, anchor 'pdf_page').
export interface DjvuViewerProps extends ViewerProps {
  initialPage?: number;
  onFirstPageRendered?: (canvas: HTMLCanvasElement) => void;
}

export function DjvuViewer({ storagePath, annotations, goTo, initialPage = 1, focus, onSelect, onContextMenu, onOpenAnnotation, onProgress, onFirstPageRendered }: Readonly<DjvuViewerProps>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<DjVuWorker | null>(null);
  const cb = useRef({ onProgress, onFirstPageRendered, onSelect });
  cb.current = { onProgress, onFirstPageRendered, onSelect };
  // A pinch to apply once the page has its new size: keep this point (relative to the scroller) in place.
  const pinchAt = useRef<{ factor: number; x: number; y: number } | null>(null);
  const wide = useMediaQuery('(min-width: 768px)');
  const [returnTo, setReturnTo] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [pageDraft, setPageDraft] = useState(String(initialPage));
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [zoom, setZoom] = useState<'fit-width' | 'fit-page' | number>('fit-width');
  const [box, setBox] = useState({ width: 800, height: 600 });
  const [toc, setToc] = useState<TocItem[]>([]);
  const [sidebar, setSidebar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ Worker }, signed] = await Promise.all([loadLibrary(), supabase.storage.from('documents').createSignedUrl(storagePath, 300)]);
      if (signed.error || !signed.data) throw signed.error ?? new Error('Could not create a signed URL.');
      const res = await fetch(signed.data.signedUrl, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`Download failed (${res.status}).`);
      const buffer = await res.arrayBuffer();
      if (cancelled) return;
      const worker = new Worker();
      workerRef.current = worker;
      await worker.createDocument(buffer);
      const [pages, contents] = (await worker.run(worker.doc.getPagesQuantity(), worker.doc.getContents())) as [number, Bookmark[] | null];
      if (cancelled) return;
      setCount(pages);
      setToc(toToc(contents));
      setPage((p) => Math.min(Math.max(1, p), pages));
    })().catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [storagePath]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBox({ width: el.clientWidth - 32, height: el.clientHeight - 32 }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !count) return;
    let cancelled = false;
    setPageDraft(String(page));
    cb.current.onProgress?.({ percentage: (page / count) * 100, page, position: { page } });
    const p = worker.doc.getPage(page);
    worker
      .run(p.getImageData(), p.getDpi(), p.getNormalizedTextZones())
      .then(([image, dpi, zones]) => {
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        const data = image as ImageData;
        canvas.width = data.width;
        canvas.height = data.height;
        canvas.getContext('2d')?.putImageData(data, 0, 0);
        setRendered({ page, width: data.width, height: data.height, dpi: (dpi as number) || 300, zones: (zones as TextZone[] | null) ?? [] });
        pinchAt.current = null;
        scrollRef.current?.scrollTo({ top: 0 });
        if (page === 1) cb.current.onFirstPageRendered?.(canvas);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [page, count]);

  // Screen size of the page: 100% is the scan at 96 dpi; the fit modes follow the reading area.
  const natural = rendered ? { width: (rendered.width * 96) / rendered.dpi, height: (rendered.height * 96) / rendered.dpi } : null;
  const scale = !natural ? 1 : zoom === 'fit-width' ? box.width / natural.width : zoom === 'fit-page' ? Math.min(box.width / natural.width, box.height / natural.height) : zoom;
  const cssWidth = natural ? natural.width * scale : 0;
  const cssHeight = natural ? natural.height * scale : 0;

  // Stretch each OCR word to the width of its box, so selections line up with the words in the image.
  useLayoutEffect(() => {
    for (const span of textRef.current?.children ?? []) {
      const el = span as HTMLElement;
      el.style.transform = '';
      const wanted = Number(el.dataset.width);
      if (el.scrollWidth > 0) el.style.transform = `scaleX(${wanted / el.scrollWidth})`;
    }
  }, [rendered, cssWidth]);

  // FR-READ-8: after a pinch, scroll so the point under the fingers stays put at the new size.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const at = pinchAt.current;
    if (!el || !at) return;
    pinchAt.current = null;
    el.scrollLeft = (el.scrollLeft + at.x) * at.factor - at.x;
    el.scrollTop = (el.scrollTop + at.y) * at.factor - at.y;
  }, [cssWidth]);

  usePinchZoom(scrollRef, pageRef, ({ factor, origin }: PinchCommit) => {
    const box = scrollRef.current?.getBoundingClientRect();
    if (!box) return;
    const next = Math.min(4, Math.max(0.25, Math.round(scale * factor * 100) / 100));
    pinchAt.current = { factor: next / scale, x: origin[0] - box.left, y: origin[1] - box.top };
    setZoom(next);
  }, !!rendered);

  // FR-READ-11: jumps (contents, page number, notes) remember the page they left, for "Back to page …".
  const jumpTo = (n: number) => {
    if (!count) return;
    const target = Math.min(Math.max(1, n), count);
    if (target !== page) setReturnTo(page);
    setPage(target);
    if (!wide) setSidebar(false);
  };

  useEffect(() => {
    const a = goTo?.anchor;
    if (a?.anchor_type !== 'pdf_page' || !count) return;
    const target = Math.min(a.anchor_data.page, count);
    setPage((p) => {
      if (p !== target) setReturnTo(p);
      return target;
    });
  }, [goTo, count]);

  const goToPage = (n: number) => count && setPage(Math.min(Math.max(1, n), count));

  // FR-READ-9: report a finger selection once its handles stop moving.
  useEffect(() => {
    let settle: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        const s = currentSelectionRef.current();
        if (s) cb.current.onSelect?.(s);
      }, 300);
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      clearTimeout(settle);
      document.removeEventListener('selectionchange', onChange);
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const actions: Record<string, () => void> = {
        ArrowRight: () => setPage((p) => Math.min(p + 1, count)),
        PageDown: () => setPage((p) => Math.min(p + 1, count)),
        ArrowLeft: () => setPage((p) => Math.max(p - 1, 1)),
        PageUp: () => setPage((p) => Math.max(p - 1, 1)),
        Home: () => setPage(1),
        End: () => setPage(count),
      };
      if (actions[e.key] && count) {
        e.preventDefault();
        actions[e.key]();
      }
    }
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [count]);

  const currentSelectionRef = useRef(() => currentSelection());
  currentSelectionRef.current = () => currentSelection();

  function currentSelection() {
    const selection = document.getSelection();
    const text = selection?.toString().trim();
    const pageBox = pageRef.current?.getBoundingClientRect();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !text || !pageBox || !textRef.current?.contains(selection.getRangeAt(0).commonAncestorContainer)) return null;
    const rects = toPageRects(textRects(selection.getRangeAt(0)), pageBox);
    return rects.length ? { text, anchor: { anchor_type: 'pdf_page' as const, anchor_data: { page, rects } } } : null;
  }

  function annotationAt(e: MouseEvent) {
    const pageBox = pageRef.current?.getBoundingClientRect();
    return pageBox ? hitTest(annotations, page, (e.clientX - pageBox.left) / pageBox.width, (e.clientY - pageBox.top) / pageBox.height) : undefined;
  }

  function handleContextMenu(e: MouseEvent) {
    const selection = currentSelection();
    const found = selection ? undefined : annotationAt(e);
    if (!selection && !found) return;
    e.preventDefault();
    if (selection) {
      onSelect?.(selection);
      onContextMenu?.({ x: e.clientX, y: e.clientY });
    } else if (found) onOpenAnnotation?.(found.id, { x: e.clientX, y: e.clientY });
  }

  function handleClick(e: MouseEvent) {
    if (!document.getSelection()?.isCollapsed) return;
    const found = annotationAt(e);
    if (found) onOpenAnnotation?.(found.id, { x: e.clientX, y: e.clientY });
  }

  const contents = <TocList items={toc} onSelect={(url) => void workerRef.current?.doc.getPageNumberByUrl(url).run().then((n) => n && jumpTo(n))} />;
  const zoomBy = (factor: number) => setZoom(Math.min(4, Math.max(0.25, Math.round(scale * factor * 100) / 100)));

  if (error) return <p className="text-body text-red">Could not load this file: {error}</p>;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {!focus && (
        <div role="toolbar" aria-label="DjVu controls" className="flex flex-wrap items-center gap-1">
          <Button variant={sidebar ? 'secondary' : 'ghost'} className={BTN} aria-pressed={sidebar} disabled={!toc.length} onClick={() => setSidebar((s) => !s)} title={toc.length ? 'Contents' : 'This file has no contents'}>☰<span className="max-sm:sr-only">Contents</span></Button>
          <Button variant="ghost" className={BTN} aria-label="Previous page" disabled={page <= 1} onClick={() => goToPage(page - 1)}>‹</Button>
          <form className="flex items-center gap-1 text-small text-fg" onSubmit={(e) => { e.preventDefault(); jumpTo(Number.parseInt(pageDraft, 10) || page); }}>
            <input aria-label="Page" inputMode="numeric" enterKeyHint="go" value={pageDraft} onChange={(e) => setPageDraft(e.target.value)} onBlur={() => setPageDraft(String(page))} className={`${FIELD} w-14 text-center`} />
            <span className="text-muted">of {count || '…'}</span>
          </form>
          <Button variant="ghost" className={BTN} aria-label="Next page" disabled={!count || page >= count} onClick={() => goToPage(page + 1)}>›</Button>
          <span className="mx-1 h-6 w-px bg-border max-sm:hidden" aria-hidden="true" />
          <Button variant="ghost" className={BTN} aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>−</Button>
          <select aria-label="Zoom" value={typeof zoom === 'number' ? 'custom' : zoom} onChange={(e) => setZoom(e.target.value as 'fit-width' | 'fit-page')} className={`${FIELD} max-sm:w-24`}>
            <option value="fit-width">Fit width</option>
            <option value="fit-page">Fit page</option>
            {typeof zoom === 'number' && <option value="custom" disabled>{Math.round(zoom * 100)}%</option>}
          </select>
          <Button variant="ghost" className={BTN} aria-label="Zoom in" onClick={() => zoomBy(1.25)}>+</Button>
          {zoom !== 'fit-width' && <Button variant="ghost" className={BTN} aria-label="Reset zoom to fit width" onClick={() => setZoom('fit-width')}>Fit</Button>}
          {rendered && !rendered.zones.length && <p className="text-small text-muted">No text layer: add page notes instead of highlights.</p>}
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-2">
        {sidebar && wide && !focus && (
          <nav aria-label="Contents" className="w-64 shrink-0 overflow-auto rounded-8 border border-border bg-dim p-2">{contents}</nav>
        )}
        <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="absolute inset-0 overflow-auto rounded-8 bg-dim p-4" style={{ touchAction: 'pan-x pan-y' }}>
          {!rendered && <p className="text-body text-muted">Loading…</p>}
          <div ref={pageRef} className="relative mx-auto bg-white shadow" style={{ width: cssWidth, height: cssHeight }} role="group" aria-label="Document page" tabIndex={0} onMouseUp={() => onSelect?.(currentSelection())} onKeyUp={() => onSelect?.(currentSelection())} onClick={handleClick} onContextMenu={handleContextMenu}>
            <canvas ref={canvasRef} className="block h-full w-full" />
            {rendered && (
              <div ref={textRef} className="absolute inset-0 overflow-hidden leading-none" style={{ color: 'transparent' }}>
                {rendered.zones.map((z, i) => (
                  <span
                    key={i}
                    data-width={(z.width / rendered.width) * cssWidth}
                    className="absolute origin-left whitespace-pre font-serif selection:bg-blue/40"
                    style={{ left: `${(z.x / rendered.width) * 100}%`, top: `${((rendered.height - z.y - z.height) / rendered.height) * 100}%`, fontSize: (z.height / rendered.height) * cssHeight * 0.85 }}
                  >
                    {z.text}
                  </span>
                ))}
              </div>
            )}
            {rendered && <PageOverlay page={rendered.page} annotations={annotations} onOpen={onOpenAnnotation} />}
          </div>
        </div>
          {returnTo !== null && returnTo !== page && <ReturnButton label={`Back to page ${returnTo}`} onReturn={() => { setPage(returnTo); setReturnTo(null); }} onDismiss={() => setReturnTo(null)} />}
        </div>
      </div>
      {sidebar && !wide && !focus && <Sheet label="Contents" onClose={() => setSidebar(false)}>{contents}</Sheet>}
    </div>
  );
}
