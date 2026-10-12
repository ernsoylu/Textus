import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { EventBus, PDFFindController, PDFLinkService, PDFViewer, SpreadMode } from 'pdfjs-dist/web/pdf_viewer.mjs';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import { supabase } from '@/lib/supabase';
import { isTypingTarget } from '@/lib/keyboard';
import { useReaderPrefs } from '@/hooks/useReaderPrefs';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePinchZoom } from '@/hooks/usePinchZoom';
import type { InkData } from '@/hooks/useAnnotations';
import { Button } from '@/components/ui/button';
import { PageOverlay } from './PageOverlay';
import { InkLayer } from './InkLayer';
import { PdfThumbnails } from './PdfThumbnails';
import { ReturnButton } from './ReturnButton';
import { Sheet } from './Sheet';
import { TocList } from './TocList';
import { hitTest, textRects, textUnderStroke, toPageRects } from './pageGeometry';
import { touchesStroke } from './inkGeometry';
import type { InkSettings, InkStroke, TocItem, ViewerProps, ViewerSelection } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
const pdfAssets = import.meta.env.DEV ? '/node_modules/pdfjs-dist/' : '/pdfjs/';
const PRESETS = [['page-width', 'Fit width'], ['page-fit', 'Fit page'], ['auto', 'Automatic']] as const;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const MAX_PINCH_SCALE = 5;
const FIT_PRESETS = ['page-width', 'page-fit', 'auto'];
// NFR-A11Y-2: 44 px reader controls.
const BTN = 'min-h-11 min-w-11 px-2 py-1';
const FIELD = 'min-h-11 rounded-4 border border-muted bg-dim px-2 py-1 text-small text-fg';
type Panel = 'pages' | 'contents' | 'search';
interface ViewLocation {
  pageNumber: number;
  top: number;
  left: number;
}

interface OutlineNode {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineNode[];
}

function outlineToToc(items: OutlineNode[], dests: Map<string, OutlineNode['dest']>, prefix = ''): TocItem[] {
  return items.map((o, i) => {
    const href = `${prefix}${i}`;
    dests.set(href, o.dest);
    return { label: o.title, href, subitems: outlineToToc(o.items, dests, `${href}.`) };
  });
}

function pageOf(node: Node | null): { page: number; div: HTMLElement } | null {
  const div = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('.page[data-page-number]');
  return div ? { page: Number(div.dataset.pageNumber), div } : null;
}

// The page content box (inside pdf.js' page border): where the canvas, text layer and our overlay all sit.
const contentBox = (div: HTMLElement) => (div.querySelector('.canvasWrapper') ?? div.querySelector('.textLayer') ?? div).getBoundingClientRect();

// FR-READ-1/4. pdf.js' own viewer components: continuous scrolling that renders only visible pages, fit width /
// fit page, two-page spreads, outline, search and working internal links. Files are private (invariant 7):
// always a short-lived signed URL. Highlights are page-relative rectangles, drawn by PageOverlay in each page.
export interface PdfViewerProps extends ViewerProps {
  initialPage?: number;
  onFirstPageRendered?: (canvas: HTMLCanvasElement) => void;
  /** FR-READ-10: ink strokes to draw, and the Mark-mode tool (null while reading). */
  ink?: { strokes: InkStroke[]; settings: InkSettings | null; onStroke: (data: InkData, text?: string) => void; onErase: (ids: string[]) => void };
}

export function PdfViewer({ storagePath, annotations, goTo, initialPage = 1, focus, ink, onSelect, onContextMenu, onOpenAnnotation, onProgress, onFirstPageRendered }: Readonly<PdfViewerProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const pdf = useRef<{ viewer: PDFViewer; bus: EventBus; link: PDFLinkService } | null>(null);
  const dests = useRef(new Map<string, OutlineNode['dest']>());
  // Callbacks change identity on every parent render; loading the document must not restart because of that.
  const cb = useRef({ onProgress, onFirstPageRendered, initialPage, onSelect, marking: !!ink?.settings });
  cb.current = { onProgress, onFirstPageRendered, initialPage, onSelect, marking: !!ink?.settings };
  const wide = useMediaQuery('(min-width: 768px)');
  const [prefs, updatePrefs] = useReaderPrefs();
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  // Page views exist only after pagesinit; pdf.js layout setters (spread mode) crash on a document without them.
  const [pagesReady, setPagesReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(initialPage);
  const [pageLabel, setPageLabel] = useState<string | null>(null);
  const [labels, setLabels] = useState<string[] | null>(null);
  const [pageDraft, setPageDraft] = useState(String(initialPage));
  const [scale, setScale] = useState({ value: 1, preset: 'page-width' });
  const [toc, setToc] = useState<TocItem[]>([]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [returnTo, setReturnTo] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [matches, setMatches] = useState<{ current: number; total: number } | null>(null);
  const [overlays, setOverlays] = useState<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    const container = containerRef.current;
    const viewerEl = viewerRef.current;
    if (!container || !viewerEl) return;
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    let firstPageCaptured = false;
    let location: ViewLocation | null = null;
    const hosts = new Map<number, HTMLDivElement>();
    const bus = new EventBus();
    const link = new PDFLinkService({ eventBus: bus });
    const findController = new PDFFindController({ eventBus: bus, linkService: link });
    const viewer = new PDFViewer({ container, viewer: viewerEl, eventBus: bus, linkService: link, findController });
    link.setViewer(viewer);
    pdf.current = { viewer, bus, link };

    const reportPage = (pageNumber: number, label: string | null) => {
      setPage(pageNumber);
      setPageLabel(label);
      cb.current.onProgress?.({ percentage: (pageNumber / viewer.pagesCount) * 100, page: pageNumber, position: { page: pageNumber } });
    };
    bus.on('pagesinit', () => {
      setPagesReady(true);
      viewer.currentScaleValue = 'page-width';
      if (cb.current.initialPage > 1) viewer.currentPageNumber = cb.current.initialPage;
      // pdf.js only announces page changes, so the page the document opens on is reported here.
      if (viewer.currentPageNumber === 1) reportPage(1, viewer.currentPageLabel ?? null);
    });
    bus.on('pagechanging', ({ pageNumber, pageLabel: label }: { pageNumber: number; pageLabel: string | null }) => reportPage(pageNumber, label));
    bus.on('scalechanging', ({ scale: value, presetValue }: { scale: number; presetValue?: string }) => setScale({ value, preset: presetValue ?? '' }));
    bus.on('updateviewarea', ({ location: at }: { location: ViewLocation }) => (location = at));
    // pdf.js clears a page's DOM when it re-renders (zoom, scrolling far away), so the overlay host is re-attached
    // after every render; React keeps rendering into the same host through a portal.
    bus.on('pagerendered', ({ pageNumber, source }: { pageNumber: number; source: { div: HTMLDivElement } }) => {
      let host = hosts.get(pageNumber);
      if (!host) {
        host = document.createElement('div');
        hosts.set(pageNumber, host);
        setOverlays(new Map(hosts));
      }
      if (host.parentNode !== source.div) source.div.append(host);
      // §15 Q2's client-side thumbnail path: capture page 1 on its first render.
      const canvas = source.div.querySelector('canvas');
      if (pageNumber === 1 && canvas && !firstPageCaptured) {
        firstPageCaptured = true;
        cb.current.onFirstPageRendered?.(canvas);
      }
    });
    const onMatches = ({ matchesCount }: { matchesCount: { current: number; total: number } }) => setMatches(matchesCount);
    bus.on('updatefindmatchescount', onMatches);
    bus.on('updatefindcontrolstate', onMatches);

    (async () => {
      const { data, error: signError } = await supabase.storage.from('documents').createSignedUrl(storagePath, 300);
      if (signError || !data) throw signError ?? new Error('Could not create a signed URL.');
      task = pdfjsLib.getDocument({
        url: data.signedUrl,
        // Fetch only the byte ranges the visible pages need, in fewer round trips, instead of streaming the
        // whole file (up to 500 MB) in the background, which starves those requests on a slow link.
        disableStream: true,
        disableAutoFetch: true,
        rangeChunkSize: 512 * 1024,
        wasmUrl: `${pdfAssets}wasm/`,
        cMapUrl: `${pdfAssets}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${pdfAssets}standard_fonts/`,
      });
      const loaded = await task.promise;
      if (cancelled) return;
      viewer.setDocument(loaded);
      link.setDocument(loaded);
      setDoc(loaded);
      const [outline, pageLabels] = await Promise.all([loaded.getOutline(), loaded.getPageLabels()]);
      if (cancelled) return;
      if (pageLabels) viewer.setPageLabels(pageLabels);
      setLabels(pageLabels);
      dests.current.clear();
      setToc(outline ? outlineToToc(outline as OutlineNode[], dests.current) : []);
    })().catch((e: Error) => !cancelled && setError(e.message));

    // Fit width / fit page are recomputed when the reading area changes size (panels, focus, rotation, iPad
    // window size), and the passage that was at the top of the screen stays there (FR-READ-7). A manual zoom
    // is left alone.
    const resize = new ResizeObserver(() => {
      const preset = viewer.currentScaleValue;
      if (!FIT_PRESETS.includes(preset) || !viewer.pagesCount) return;
      const at = location;
      viewer.currentScaleValue = preset;
      if (at) viewer.scrollPageIntoView({ pageNumber: at.pageNumber, destArray: [null, { name: 'XYZ' }, at.left, at.top, null], allowNegativeOffset: true });
    });
    resize.observe(container);

    // FR-READ-9: a finger selection is adjusted with handles, without a mouse-up; report it once it settles.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const onSelectionChange = () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        const selection = cb.current.marking ? null : currentSelection();
        if (selection) cb.current.onSelect?.(selection);
      }, 300);
    };
    document.addEventListener('selectionchange', onSelectionChange);

    return () => {
      cancelled = true;
      clearTimeout(settle);
      document.removeEventListener('selectionchange', onSelectionChange);
      resize.disconnect();
      void task?.destroy();
      pdf.current = null;
      setDoc(null);
      setPagesReady(false);
      setOverlays(new Map());
    };
  }, [storagePath]);

  useEffect(() => {
    if (pagesReady && pdf.current) pdf.current.viewer.spreadMode = prefs.twoPage ? SpreadMode.ODD : SpreadMode.NONE;
  }, [pagesReady, prefs.twoPage]);

  useEffect(() => setPageDraft(pageLabel ?? String(page)), [page, pageLabel]);

  // FR-READ-8: pinch zooms around the fingers (pdf.js keeps `origin` in place); two fingers also pan.
  usePinchZoom(containerRef, viewerRef, ({ factor, origin }) => {
    const viewer = pdf.current?.viewer;
    if (viewer) viewer.updateScale({ scaleFactor: Math.min(factor, MAX_PINCH_SCALE / viewer.currentScale), origin });
  }, !!doc);

  // FR-READ-11: jumps (pages, contents, search, notes) remember where reading was, for "Back to page …".
  const jump = (go: () => void) => {
    const from = pdf.current?.viewer.currentPageNumber;
    go();
    if (from && pdf.current?.viewer.currentPageNumber !== from) setReturnTo(from);
    if (!wide) setPanel(null);
  };

  // Jump to an annotation: its page, then its first highlighted line (or stroke) a third of the way down.
  useEffect(() => {
    const p = pdf.current;
    const container = containerRef.current;
    if (!goTo || !doc || !p || !container) return;
    const a = goTo.anchor;
    if (a.anchor_type !== 'pdf_page' && a.anchor_type !== 'pdf_ink') return;
    const target = a.anchor_data.page;
    const y = a.anchor_type === 'pdf_page' ? a.anchor_data.rects?.[0]?.y1 : a.anchor_data.points[0]?.[1];
    const from = p.viewer.currentPageNumber;
    p.viewer.currentPageNumber = target;
    if (from !== target) setReturnTo(from);
    const div = p.viewer.getPageView(target - 1)?.div as HTMLElement | undefined;
    if (div && y !== undefined) container.scrollTop = div.offsetTop + y * div.clientHeight - container.clientHeight / 3;
  }, [goTo, doc]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const viewer = pdf.current?.viewer;
      if (!viewer || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const actions: Record<string, () => void> = {
        ArrowRight: () => viewer.nextPage(),
        ArrowLeft: () => viewer.previousPage(),
        Home: () => (viewer.currentPageNumber = 1),
        End: () => (viewer.currentPageNumber = viewer.pagesCount),
        '+': () => viewer.increaseScale(),
        '=': () => viewer.increaseScale(),
        '-': () => viewer.decreaseScale(),
        '0': () => (viewer.currentScaleValue = 'page-width'),
      };
      const action = actions[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    }
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, []);

  function currentSelection(): ViewerSelection | null {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0).cloneRange();
    if (!containerRef.current?.contains(range.commonAncestorContainer)) return null;
    const start = pageOf(range.startContainer);
    if (!start) return null;
    // FR-READ-9: a selection running across pages is cut to its first page, so the saved quote matches the
    // highlighted rectangles; the reader is told before saving.
    let notice: string | undefined;
    if (!start.div.contains(range.endContainer)) {
      const layer = start.div.querySelector('.textLayer');
      if (!layer) return null;
      range.setEnd(layer, layer.childNodes.length);
      notice = `Only the part on page ${start.div.dataset.pageLabel ?? start.page} is saved. Select the rest separately.`;
    }
    const text = range.toString().trim();
    const rects = toPageRects(textRects(range), contentBox(start.div));
    return text && rects.length ? { text, notice, anchor: { anchor_type: 'pdf_page' as const, anchor_data: { page: start.page, rects } } } : null;
  }

  function handleMouseUp() {
    if (!ink?.settings) onSelect?.(currentSelection());
  }

  // A highlighter stroke keeps the text under it, so it is found later like a text highlight (FR-READ-10).
  function commitStroke(data: InkData) {
    const div = pdf.current?.viewer.getPageView(data.page - 1)?.div as HTMLElement | undefined;
    const layer = data.tool === 'highlighter' ? div?.querySelector('.textLayer') : null;
    ink?.onStroke(data, div && layer ? textUnderStroke(layer, contentBox(div), data.points, data.width) : undefined);
  }

  function handleClick(e: MouseEvent) {
    if (!document.getSelection()?.isCollapsed || ink?.settings) return;
    const hit = pageOf(e.target as Node);
    if (!hit) return;
    const box = contentBox(hit.div);
    const [x, y] = [(e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height];
    const found =
      hitTest(annotations, hit.page, x, y) ??
      // Reading mode: tapping a freehand highlight opens its note too.
      ink?.strokes.filter((s) => s.data.page === hit.page && s.data.tool === 'highlighter').reverse().find((s) => touchesStroke(s.data.points, x, y, s.data.width / 2, box.height / box.width));
    if (found) onOpenAnnotation?.(found.id, { x: e.clientX, y: e.clientY });
  }

  function handleContextMenu(e: MouseEvent) {
    const selection = currentSelection();
    if (selection) {
      e.preventDefault();
      onSelect?.(selection);
      onContextMenu?.({ x: e.clientX, y: e.clientY });
      return;
    }
    const hit = pageOf(e.target as Node);
    if (!hit) return;
    const box = contentBox(hit.div);
    const found = hitTest(annotations, hit.page, (e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height);
    if (found) {
      e.preventDefault();
      onOpenAnnotation?.(found.id, { x: e.clientX, y: e.clientY });
    }
  }

  function search(e: FormEvent, previous = false) {
    e.preventDefault();
    const q = query.trim();
    if (!pdf.current) return;
    if (!q) {
      pdf.current.bus.dispatch('findbarclose', { source: null });
      setSearched('');
      setMatches(null);
      return;
    }
    const first = q !== searched;
    if (first) setReturnTo(pdf.current.viewer.currentPageNumber);
    pdf.current.bus.dispatch('find', { source: null, type: first ? '' : 'again', query: q, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
    setSearched(q);
  }

  const setZoom = (value: string) => {
    if (pdf.current) pdf.current.viewer.currentScaleValue = value;
  };
  const zoomValue = scale.preset || (ZOOMS.includes(Math.round(scale.value * 100) / 100) ? String(Math.round(scale.value * 100) / 100) : 'custom');
  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? null : p));

  if (error) return <p className="text-body text-red">Could not load this file: {error}</p>;

  const panelBody: ReactNode = panel && (
    <>
      <div role="tablist" aria-label="Navigate" className="flex gap-1">
        {(['pages', 'contents', 'search'] as const).map((p) => (
          <Button key={p} role="tab" aria-selected={panel === p} variant={panel === p ? 'secondary' : 'ghost'} className={`${BTN} flex-1 capitalize`} disabled={p === 'contents' && !toc.length} title={p === 'contents' && !toc.length ? 'This PDF has no outline' : undefined} onClick={() => setPanel(p)}>
            {p}
          </Button>
        ))}
      </div>
      {panel === 'pages' && doc && <PdfThumbnails doc={doc} current={page} labels={labels} onSelect={(n) => jump(() => { if (pdf.current) pdf.current.viewer.currentPageNumber = n; })} />}
      {panel === 'contents' && <TocList items={toc} onSelect={(href) => jump(() => { const dest = dests.current.get(href); if (dest) void pdf.current?.link.goToDestination(dest); })} />}
      {panel === 'search' && (
        <form role="search" className="flex flex-wrap items-center gap-1" onSubmit={search}>
          <input type="search" aria-label="Search in document" placeholder="Search…" value={query} data-autofocus onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && e.shiftKey) search(e, true); }} className={`${FIELD} min-w-0 flex-1`} />
          {searched && <span className="text-small text-muted" aria-live="polite">{matches?.total ? `${matches.current} / ${matches.total}` : 'No matches'}</span>}
          {searched && !!matches?.total && (
            <>
              <Button type="button" variant="ghost" className={BTN} aria-label="Previous match" onClick={(e) => search(e, true)}>↑</Button>
              <Button type="button" variant="ghost" className={BTN} aria-label="Next match" onClick={(e) => search(e)}>↓</Button>
            </>
          )}
        </form>
      )}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {!focus && (
        <div role="toolbar" aria-label="PDF controls" className="flex flex-wrap items-center gap-1">
          <Button variant={panel ? 'secondary' : 'ghost'} className={BTN} aria-pressed={!!panel} aria-label="Pages, contents and search" disabled={!doc} onClick={() => togglePanel('pages')}>☰<span className="max-sm:sr-only">Navigate</span></Button>
          <Button variant="ghost" className={BTN} aria-label="Previous page" disabled={!doc || page <= 1} onClick={() => pdf.current?.viewer.previousPage()}>‹</Button>
          <form className="flex items-center gap-1 text-small text-fg" onSubmit={(e) => { e.preventDefault(); jump(() => { if (pdf.current) pdf.current.viewer.currentPageLabel = pageDraft; }); }}>
            <input aria-label="Page" inputMode="numeric" enterKeyHint="go" value={pageDraft} onChange={(e) => setPageDraft(e.target.value)} onBlur={() => setPageDraft(pageLabel ?? String(page))} className={`${FIELD} w-14 text-center`} />
            <span className="text-muted">{pageLabel && pageLabel !== String(page) ? `(${page} of ${doc?.numPages ?? '…'})` : `of ${doc?.numPages ?? '…'}`}</span>
          </form>
          <Button variant="ghost" className={BTN} aria-label="Next page" disabled={!doc || page >= (doc?.numPages ?? 0)} onClick={() => pdf.current?.viewer.nextPage()}>›</Button>
          <span className="mx-1 h-6 w-px bg-border max-sm:hidden" aria-hidden="true" />
          <Button variant="ghost" className={BTN} aria-label="Zoom out" disabled={!doc} onClick={() => pdf.current?.viewer.decreaseScale()}>−</Button>
          <select aria-label="Zoom" disabled={!doc} value={zoomValue} onChange={(e) => setZoom(e.target.value)} className={`${FIELD} max-sm:w-20`}>
            {PRESETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            {ZOOMS.map((z) => <option key={z} value={String(z)}>{Math.round(z * 100)}%</option>)}
            {zoomValue === 'custom' && <option value="custom" disabled>{Math.round(scale.value * 100)}%</option>}
          </select>
          <Button variant="ghost" className={BTN} aria-label="Zoom in" disabled={!doc} onClick={() => pdf.current?.viewer.increaseScale()}>+</Button>
          {scale.preset !== 'page-width' && <Button variant="ghost" className={BTN} aria-label="Reset zoom to fit width" title="Reset zoom (0)" onClick={() => setZoom('page-width')}>Fit</Button>}
          <Button variant={prefs.twoPage ? 'secondary' : 'ghost'} className={`${BTN} max-md:hidden`} aria-pressed={prefs.twoPage} onClick={() => updatePrefs({ twoPage: !prefs.twoPage })}>Two pages</Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-2">
        {panel && wide && !focus && (
          <nav aria-label="Pages, contents and search" className="flex w-64 shrink-0 flex-col gap-2 overflow-auto rounded-8 border border-border bg-dim p-2">{panelBody}</nav>
        )}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-8 bg-dim">
          {!doc && <p className="absolute inset-0 z-10 p-4 text-body text-muted">Loading…</p>}
          <div ref={containerRef} role="group" aria-label="Document pages" tabIndex={0} className="absolute inset-0 overflow-auto" style={{ touchAction: 'pan-x pan-y' }} onMouseUp={handleMouseUp} onKeyUp={handleMouseUp} onClick={handleClick} onContextMenu={handleContextMenu}>
            <div ref={viewerRef} className="pdfViewer" />
          </div>
          {returnTo !== null && returnTo !== page && (
            <ReturnButton label={`Back to page ${labels?.[returnTo - 1] ?? returnTo}`} onReturn={() => { if (pdf.current) pdf.current.viewer.currentPageNumber = returnTo; setReturnTo(null); }} onDismiss={() => setReturnTo(null)} />
          )}
        </div>
      </div>
      {panel && !wide && !focus && <Sheet label="Navigate" onClose={() => setPanel(null)}>{panelBody}</Sheet>}
      {[...overlays].map(([n, host]) => createPortal(
        <>
          <PageOverlay page={n} annotations={annotations} onOpen={onOpenAnnotation} />
          {ink && <InkLayer page={n} strokes={ink.strokes.filter((s) => s.data.page === n)} settings={ink.settings} onStroke={commitStroke} onErase={ink.onErase} />}
        </>,
        host,
        String(n),
      ))}
    </div>
  );
}
