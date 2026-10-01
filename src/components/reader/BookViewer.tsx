import { useEffect, useRef, useState, type FormEvent } from 'react';
import 'foliate-js/view.js';
import { Overlayer } from 'foliate-js/overlayer.js';
import type { FoliateLocation, FoliateTocItem, FoliateView } from 'foliate-js/view.js';
import { supabase } from '@/lib/supabase';
import { isTypingTarget } from '@/lib/keyboard';
import { inertBookHtml } from '@/lib/inertBookHtml';
import { useReaderPrefs, type ReaderPrefs } from '@/hooks/useReaderPrefs';
import { Button } from '@/components/ui/button';
import { TocList } from './TocList';
import { COMMENT_ICON_PATH } from './pageGeometry';
import type { Point, TocItem, ViewerProps } from './types';

const THEMES: Record<ReaderPrefs['theme'], { bg: string; fg: string; link: string; blend: string }> = {
  light: { bg: '#ffffff', fg: '#1f2328', link: '#0b62a3', blend: 'multiply' },
  sepia: { bg: '#f4ecd8', fg: '#433422', link: '#8a4b0f', blend: 'multiply' },
  dark: { bg: '#232a2e', fg: '#d3c6aa', link: '#7fbbb3', blend: 'screen' },
};

// Injected into every section. Dark and sepia override the book's own text colors, or dark text would vanish.
const bookCss = (prefs: ReaderPrefs) => {
  const t = THEMES[prefs.theme];
  return `
    html { color-scheme: ${prefs.theme === 'dark' ? 'dark' : 'light'}; background: ${t.bg} !important; color: ${t.fg} !important; font-size: ${prefs.fontSize}% !important; }
    body { background: transparent !important; color: inherit !important; }
    ${prefs.theme === 'light' ? '' : 'body *:not(img, svg, video) { color: inherit !important; background-color: transparent !important; border-color: currentColor !important; }'}
    p, li, blockquote, dd, div { line-height: ${prefs.lineHeight} !important; }
    a:link, a:visited { color: ${t.link} !important; }
    pre { white-space: pre-wrap !important; }
    img, svg { max-width: 100%; }
  `;
};

const SVG = 'http://www.w3.org/2000/svg';

// A highlight plus, when it has a comment, a small bubble after its last line (like an inline comment in Word).
// The overlay is an SVG over the book's iframe in this document, so the marker gets ordinary click events.
function drawHighlight(rects: DOMRectList, options: { color: string; onMarker?: (at: Point) => void }): SVGElement {
  const group = document.createElementNS(SVG, 'g');
  group.append(Overlayer.highlight(rects, { color: options.color }));
  const last = rects[rects.length - 1];
  if (options.onMarker && last) {
    const marker = document.createElementNS(SVG, 'g');
    marker.setAttribute('transform', `translate(${last.right + 1} ${last.top - 9}) scale(1.15)`);
    marker.setAttribute('role', 'button');
    marker.style.pointerEvents = 'auto';
    marker.style.cursor = 'pointer';
    const bg = document.createElementNS(SVG, 'path');
    bg.setAttribute('d', COMMENT_ICON_PATH);
    bg.setAttribute('fill', options.color);
    bg.setAttribute('stroke', '#232a2e');
    marker.append(bg);
    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      const box = marker.getBoundingClientRect();
      options.onMarker?.({ x: box.left, y: box.bottom });
    });
    group.append(marker);
  }
  return group;
}

const toToc = (items: FoliateTocItem[] | null | undefined): TocItem[] => (items ?? []).map((i) => ({ label: i.label?.trim() ?? '', href: i.href, subitems: toToc(i.subitems) }));

interface SearchHit {
  cfi: string;
  label: string;
  pre: string;
  match: string;
  post: string;
}

// FR-READ-2/6. foliate-js renders EPUB, MOBI, AZW3 (KF8), FB2 and CBZ with one API: paginated or scrolled,
// one or two columns, contents, full-text search, and EPUB CFIs for positions and highlights (the same CFIs
// epub.js wrote, so saved positions and highlights carry over). Files are private (invariant 7): a short-lived
// signed URL, fetched as bytes. Books' own scripts never run: the page's CSP blocks them (deploy/security-headers.conf)
// and every book page carries its own script-src 'none' (inertBookHtml).
export interface BookViewerProps extends ViewerProps {
  format: string;
  initialCfi?: string;
}

export function BookViewer({ storagePath, format, initialCfi, annotations, goTo, onSelect, onContextMenu, onOpenAnnotation, onProgress }: Readonly<BookViewerProps>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const cb = useRef({ onSelect, onContextMenu, onOpenAnnotation, onProgress });
  cb.current = { onSelect, onContextMenu, onOpenAnnotation, onProgress };
  const drawn = useRef(new Map<string, string>()); // cfi -> "color|note" currently drawn
  const searchToken = useRef(0);
  const [prefs, updatePrefs] = useReaderPrefs();
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [fixedLayout, setFixedLayout] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [ticks, setTicks] = useState<number[]>([]);
  const [location, setLocation] = useState<FoliateLocation | null>(null);
  const [panel, setPanel] = useState<'contents' | 'search' | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const view = document.createElement('foliate-view') as FoliateView;
    view.style.cssText = 'display:block;width:100%;height:100%';
    host.append(view);
    viewRef.current = view;
    view.addEventListener('external-link', (event) => {
      event.preventDefault();
      try {
        const url = new URL((event as CustomEvent<{ href_: string }>).detail.href_);
        if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) globalThis.open(url.href, '_blank', 'noopener,noreferrer');
      } catch { /* Invalid/untrusted schemes cannot navigate out of the reader. */ }
    });
    const drawnNow = drawn.current;

    const annotationFor = (cfi: string) => annotationsRef.current.find((a) => a.anchor.anchor_type === 'epub_cfi' && a.anchor.anchor_data.cfi === cfi);
    const frameOffset = (doc: Document) => {
      const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
      return { x: frame?.left ?? 0, y: frame?.top ?? 0 };
    };

    view.addEventListener('relocate', (e) => {
      const detail = (e as CustomEvent<FoliateLocation>).detail;
      setLocation(detail);
      if (Number.isFinite(detail.fraction)) cb.current.onProgress?.({ percentage: detail.fraction * 100, position: { cfi: detail.cfi } });
    });
    view.addEventListener('load', (e) => {
      const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail;
      const selectionIn = () => {
        const selection = doc.getSelection();
        const text = selection?.toString().trim();
        if (!selection || selection.isCollapsed || !selection.rangeCount || !text) return null;
        return { text, anchor: { anchor_type: 'epub_cfi' as const, anchor_data: { cfi: view.getCFI(index, selection.getRangeAt(0)) } } };
      };
      const report = () => cb.current.onSelect?.(selectionIn());
      doc.addEventListener('pointerup', report);
      doc.addEventListener('keyup', report);
      doc.addEventListener('contextmenu', (ev) => {
        const selection = selectionIn();
        if (!selection) return;
        ev.preventDefault();
        cb.current.onSelect?.(selection);
        const offset = frameOffset(doc);
        cb.current.onContextMenu?.({ x: offset.x + ev.clientX, y: offset.y + ev.clientY });
      });
      // Keys pressed inside the book's iframe never reach this page; hand the reader's shortcuts over.
      doc.addEventListener('keydown', (ev) => {
        if (['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'f', 'Escape'].includes(ev.key) && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
          ev.preventDefault();
          globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: ev.key, shiftKey: ev.shiftKey }));
        }
      });
    });
    view.addEventListener('create-overlay', () => {
      for (const cfi of drawnNow.keys()) void view.addAnnotation({ value: cfi });
    });
    view.addEventListener('draw-annotation', (e) => {
      const { draw, annotation } = (e as CustomEvent<{ draw: (fn: typeof drawHighlight, options: Parameters<typeof drawHighlight>[1]) => void; annotation: { value: string } }>).detail;
      const a = annotationFor(annotation.value);
      if (!a) return;
      draw(drawHighlight, { color: a.color, onMarker: a.note ? (at) => cb.current.onOpenAnnotation?.(a.id, at) : undefined });
    });
    view.addEventListener('show-annotation', (e) => {
      const { value, range } = (e as CustomEvent<{ value: string; range: Range }>).detail;
      const a = annotationFor(value);
      if (!a) return;
      const box = range.getBoundingClientRect();
      const offset = frameOffset(range.startContainer.ownerDocument ?? document);
      cb.current.onOpenAnnotation?.(a.id, { x: offset.x + box.left, y: offset.y + box.bottom });
    });

    (async () => {
      const { data, error: signError } = await supabase.storage.from('documents').createSignedUrl(storagePath, 300);
      if (signError || !data) throw signError ?? new Error('Could not create a signed URL.');
      const res = await fetch(data.signedUrl, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`Download failed (${res.status}).`);
      // foliate-js recognises CBZ and FB2 by file name, EPUB and MOBI/AZW3 by their bytes.
      const file = new File([await res.blob()], `book.${format}`);
      if (cancelled) return;
      await view.open(file);
      if (cancelled) return;
      view.book.transformTarget?.addEventListener('data', (e) => {
        const detail = (e as CustomEvent<{ data: unknown; type: string }>).detail;
        if (/(?:html|svg)/.test(detail.type)) detail.data = Promise.resolve(detail.data).then((d) => (typeof d === 'string' ? inertBookHtml(d) : d));
      });
      setFixedLayout(view.isFixedLayout);
      setToc(toToc(view.book.toc));
      await view.init({ lastLocation: initialCfi || undefined, showTextStart: !initialCfi });
      if (cancelled) return;
      setTicks(view.getSectionFractions().filter(Number.isFinite));
      setReady(true);
    })().catch((e: Error) => {
      if (cancelled) return;
      console.error('reader: could not open the book', e);
      setError(format === 'azw3' || format === 'mobi' ? 'This Kindle file could not be opened. DRM-protected books can’t be read here.' : e.message);
    });

    return () => {
      cancelled = true;
      drawnNow.clear();
      view.close();
      view.remove();
      viewRef.current = null;
      setReady(false);
    };
    // initialCfi is only the starting point; later position changes must not reload the book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storagePath, format]);

  // Reader settings apply live and are remembered on this device.
  useEffect(() => {
    const view = viewRef.current;
    // `ready` can briefly outlive the view it was set for (the view is recreated on a new file or a hot reload).
    if (!view?.renderer || !ready) return;
    view.style.setProperty('--overlayer-highlight-blend-mode', THEMES[prefs.theme].blend);
    view.style.setProperty('--overlayer-highlight-opacity', '0.4');
    const r = view.renderer;
    if (view.isFixedLayout) {
      r.setAttribute('zoom', 'fit-page');
      return;
    }
    r.setAttribute('flow', prefs.flow);
    r.setAttribute('max-column-count', prefs.twoPage ? '2' : '1');
    r.setAttribute('gap', '6%');
    r.setAttribute('margin', '40px');
    r.setAttribute('max-inline-size', '760px');
    r.setAttribute('animated', '');
    r.setStyles?.(bookCss(prefs));
  }, [prefs, ready]);

  // Highlights: add new ones, redraw changed ones (color or comment), remove deleted ones.
  useEffect(() => {
    const view = viewRef.current;
    if (!view?.renderer || !ready) return;
    const wanted = new Map(annotations.flatMap((a) => (a.anchor.anchor_type === 'epub_cfi' ? [[a.anchor.anchor_data.cfi, `${a.color}|${a.note ? 1 : 0}`] as const] : [])));
    for (const [cfi, key] of drawn.current) {
      if (wanted.get(cfi) !== key) {
        void view.deleteAnnotation({ value: cfi });
        drawn.current.delete(cfi);
      }
    }
    let added = false;
    for (const [cfi, key] of wanted) {
      if (!drawn.current.has(cfi)) {
        drawn.current.set(cfi, key);
        void view.addAnnotation({ value: cfi });
        added = true;
      }
    }
    // A new highlight replaces the selection it was made from (which lives in the book's iframe).
    if (added) view.deselect();
  }, [annotations, ready]);

  useEffect(() => {
    if (goTo && ready && viewRef.current?.renderer && goTo.anchor.anchor_type === 'epub_cfi') void viewRef.current.goTo(goTo.anchor.anchor_data.cfi);
  }, [goTo, ready]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const view = viewRef.current;
      if (!view || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') void view.goRight();
      else if (e.key === 'ArrowLeft') void view.goLeft();
      else if (e.key === 'PageDown') void view.next();
      else if (e.key === 'PageUp') void view.prev();
      else return;
      e.preventDefault();
    }
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, []);

  async function search(e: FormEvent) {
    e.preventDefault();
    const view = viewRef.current;
    const q = query.trim();
    if (!view) return;
    const token = ++searchToken.current;
    view.clearSearch();
    setHits([]);
    if (!q) return setSearching(null);
    setSearching(0);
    for await (const result of view.search({ query: q })) {
      if (token !== searchToken.current) return;
      if (result === 'done') break;
      if ('progress' in result) setSearching(result.progress);
      else if ('subitems' in result) setHits((prev) => [...prev, ...result.subitems.map((s) => ({ cfi: s.cfi, label: result.label, ...s.excerpt }))]);
    }
    if (token === searchToken.current) setSearching(null);
  }

  const setLineHeight = (d: number) => updatePrefs({ lineHeight: Math.round(Math.min(2.4, Math.max(1, prefs.lineHeight + d)) * 10) / 10 });
  const setFontSize = (d: number) => updatePrefs({ fontSize: Math.min(220, Math.max(60, prefs.fontSize + d)) });
  // Some books (e.g. a MOBI's first record) report no fraction until the reader moves.
  const fraction = Number.isFinite(location?.fraction) ? (location?.fraction as number) : 0;
  const togglePanel = (p: 'contents' | 'search') => setPanel((cur) => (cur === p ? null : p));
  const where = location?.pageItem?.label ? `Page ${location.pageItem.label}` : location?.location ? `Location ${location.location.current + 1} of ${location.location.total}` : '';

  if (error) return <p className="text-body text-red">Could not load this file: {error}</p>;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div role="toolbar" aria-label="Book controls" className="flex flex-wrap items-center gap-1">
        <Button variant={panel === 'contents' ? 'secondary' : 'ghost'} className="min-h-9 px-2 py-1" aria-pressed={panel === 'contents'} disabled={!toc.length} onClick={() => togglePanel('contents')}>☰ Contents</Button>
        <Button variant={panel === 'search' ? 'secondary' : 'ghost'} className="min-h-9 px-2 py-1" aria-pressed={panel === 'search'} disabled={!ready} onClick={() => togglePanel('search')}>Search</Button>
        <Button variant="ghost" className="min-h-9 px-2 py-1" aria-label="Previous page" disabled={!ready} onClick={() => void viewRef.current?.goLeft()}>‹</Button>
        <Button variant="ghost" className="min-h-9 px-2 py-1" aria-label="Next page" disabled={!ready} onClick={() => void viewRef.current?.goRight()}>›</Button>
        <p className="min-w-0 truncate px-1 text-small text-muted">{location?.tocItem?.label ?? ''}</p>
        {!fixedLayout && (
          <details className="relative ml-auto">
            <summary className="flex min-h-9 cursor-pointer list-none items-center rounded-8 px-3 text-label text-fg hover:bg-raised/60" aria-label="Text and layout settings">Aa</summary>
            <div className="absolute right-0 z-20 mt-1 flex w-64 flex-col gap-3 rounded-8 border border-border bg-raised p-3 shadow-lg">
              <div className="flex items-center justify-between text-small text-fg">
                Text size
                <span className="flex items-center gap-1">
                  <Button variant="ghost" className="min-h-8 px-2 py-0" aria-label="Smaller text" onClick={() => setFontSize(-10)}>A−</Button>
                  <span className="w-10 text-center text-muted">{prefs.fontSize}%</span>
                  <Button variant="ghost" className="min-h-8 px-2 py-0" aria-label="Larger text" onClick={() => setFontSize(10)}>A+</Button>
                </span>
              </div>
              <div className="flex items-center justify-between text-small text-fg">
                Line spacing
                <span className="flex items-center gap-1">
                  <Button variant="ghost" className="min-h-8 px-2 py-0" aria-label="Tighter lines" onClick={() => setLineHeight(-0.1)}>−</Button>
                  <span className="w-10 text-center text-muted">{prefs.lineHeight.toFixed(1)}</span>
                  <Button variant="ghost" className="min-h-8 px-2 py-0" aria-label="Looser lines" onClick={() => setLineHeight(0.1)}>+</Button>
                </span>
              </div>
              <label className="flex items-center justify-between text-small text-fg">
                Theme
                <select className="rounded-4 border border-muted bg-dim py-1 pl-2 text-small text-fg" value={prefs.theme} onChange={(e) => updatePrefs({ theme: e.target.value as ReaderPrefs['theme'] })}>
                  <option value="light">Light</option>
                  <option value="sepia">Sepia</option>
                  <option value="dark">Dark</option>
                </select>
              </label>
              <label className="flex items-center justify-between text-small text-fg">
                Layout
                <select className="rounded-4 border border-muted bg-dim py-1 pl-2 text-small text-fg" value={prefs.flow} onChange={(e) => updatePrefs({ flow: e.target.value as ReaderPrefs['flow'] })}>
                  <option value="paginated">Pages</option>
                  <option value="scrolled">Scrolling</option>
                </select>
              </label>
              <label className="flex items-center justify-between text-small text-fg">
                Two columns on wide screens
                <input type="checkbox" checked={prefs.twoPage} onChange={(e) => updatePrefs({ twoPage: e.target.checked })} />
              </label>
            </div>
          </details>
        )}
      </div>
      <div className="flex min-h-0 flex-1 gap-2">
        {panel && (
          <nav aria-label={panel === 'contents' ? 'Contents' : 'Search results'} className="flex w-72 shrink-0 flex-col gap-2 overflow-auto rounded-8 border border-border bg-dim p-2">
            {panel === 'contents' && <TocList items={toc} active={location?.tocItem?.href} onSelect={(href) => void viewRef.current?.goTo(href)} />}
            {panel === 'search' && (
              <>
                <form role="search" onSubmit={(e) => void search(e)} className="flex gap-1">
                  <input type="search" aria-label="Search in book" placeholder="Search the book…" value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 rounded-4 border border-muted bg-bg px-2 py-1 text-small text-fg" />
                  <Button type="submit" variant="secondary" className="min-h-8 px-2 py-0">Find</Button>
                </form>
                <p className="text-small text-muted" aria-live="polite">{searching !== null ? `Searching… ${Math.round(searching * 100)}%` : query.trim() && `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`}</p>
                <ul className="flex flex-col gap-1">
                  {hits.map((h) => (
                    <li key={h.cfi}>
                      <button type="button" onClick={() => void viewRef.current?.goTo(h.cfi)} className="w-full rounded-4 p-2 text-left text-small text-muted hover:bg-raised">
                        {h.label && <span className="block text-fg">{h.label}</span>}
                        {h.pre}<mark className="bg-yellow-bg text-yellow">{h.match}</mark>{h.post}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </nav>
        )}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-8" style={{ background: THEMES[prefs.theme].bg }}>
          {!ready && <p className="absolute inset-0 z-10 p-4 text-body text-muted">Loading…</p>}
          <div ref={hostRef} className="absolute inset-0" />
          <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => void viewRef.current?.goLeft()} className="absolute inset-y-0 left-0 z-10 w-8 text-2xl text-muted opacity-0 transition-opacity hover:bg-black/5 hover:opacity-100">‹</button>
          <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => void viewRef.current?.goRight()} className="absolute inset-y-0 right-0 z-10 w-8 text-2xl text-muted opacity-0 transition-opacity hover:bg-black/5 hover:opacity-100">›</button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          aria-label="Position in book"
          min={0}
          max={1}
          step="any"
          list="book-sections"
          disabled={!ready}
          value={fraction}
          onChange={(e) => void viewRef.current?.goToFraction(Number(e.target.value))}
          className="min-w-0 flex-1 accent-green"
        />
        <datalist id="book-sections">{ticks.map((t) => <option key={t} value={t} />)}</datalist>
        <p className="shrink-0 text-small text-muted">{where}{where && ' · '}{Math.round(fraction * 100)}%</p>
      </div>
    </div>
  );
}
