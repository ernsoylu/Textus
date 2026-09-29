import { useEffect, useRef, useState } from 'react';
import ePub, { type Book, type Rendition } from 'epubjs';
import { supabase } from '@/lib/supabase';
import { isTypingTarget } from '@/lib/keyboard';
import { useReaderPrefs, type ReaderPrefs } from '@/hooks/useReaderPrefs';
import { Button } from '@/components/ui/button';
import type { Progress } from '@/hooks/useReadingState';

// FR-READ-2. Files are private (invariant 7): a short-lived signed URL, fetched as bytes so
// epub.js renders from memory. Highlights come in as `highlights` ({id, cfi, color}) and are
// painted with epub.js annotations; a text selection is reported through onSelect.
export interface EpubHighlight {
  id: string;
  cfi: string;
  color: string;
}

export interface EpubViewerProps {
  storagePath: string;
  initialCfi?: string;
  goTo?: string;
  highlights: EpubHighlight[];
  onProgress: (p: Progress) => void;
  onSelect: (sel: { cfi: string; text: string } | null) => void;
}

interface TocEntry {
  label: string;
  href: string;
  depth: number;
}

const THEMES: Record<ReaderPrefs['theme'], Record<string, Record<string, string>>> = {
  light: { body: { background: '#ffffff', color: '#1f2328' } },
  sepia: { body: { background: '#f4ecd8', color: '#433422' } },
  dark: { body: { background: '#232a2e', color: '#d3c6aa' } },
};

interface NavItem {
  label: string;
  href: string;
  subitems?: NavItem[];
}

const flattenToc = (items: NavItem[], depth = 0): TocEntry[] =>
  items.flatMap((item) => [{ label: item.label.trim(), href: item.href, depth }, ...flattenToc(item.subitems ?? [], depth + 1)]);

export function EpubViewer({ storagePath, initialCfi, goTo, highlights, onProgress, onSelect }: Readonly<EpubViewerProps>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const painted = useRef(new Map<string, string>()); // cfi -> color already drawn
  const callbacks = useRef({ onProgress, onSelect });
  callbacks.current = { onProgress, onSelect };
  const [prefs, updatePrefs] = useReaderPrefs();
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [percent, setPercent] = useState<number | null>(null);
  const [percentDraft, setPercentDraft] = useState('');

  useEffect(() => {
    let cancelled = false;
    const drawn = painted.current;
    setError(null);
    (async () => {
      const { data, error: signError } = await supabase.storage.from('documents').createSignedUrl(storagePath, 300);
      if (signError || !data) throw signError ?? new Error('Could not create a signed URL.');
      const res = await fetch(data.signedUrl, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`Download failed (${res.status}).`);
      const bytes = await res.arrayBuffer();
      if (cancelled || !hostRef.current) return;
      const book = ePub(bytes);
      const rendition = book.renderTo(hostRef.current, { width: '100%', height: 640, flow: 'paginated' });
      bookRef.current = book;
      renditionRef.current = rendition;
      for (const [name, rules] of Object.entries(THEMES)) rendition.themes.register(name, rules);
      rendition.on('relocated', (loc: { start: { cfi: string } }) => {
        const fraction = book.locations.length() ? book.locations.percentageFromCfi(loc.start.cfi) : 0;
        setPercent(book.locations.length() ? fraction * 100 : null);
        callbacks.current.onProgress({ percentage: fraction * 100, position: { cfi: loc.start.cfi } });
      });
      rendition.on('selected', (cfiRange: string) => {
        const text = rendition.getRange(cfiRange)?.toString().trim();
        callbacks.current.onSelect(text ? { cfi: cfiRange, text } : null);
      });
      // Keys pressed while the book (an iframe) has focus never reach the page's own listener.
      rendition.on('keyup', (e: KeyboardEvent) => {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') void rendition.next();
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') void rendition.prev();
      });
      book.loaded.navigation.then((nav: { toc: NavItem[] }) => !cancelled && setToc(flattenToc(nav.toc))).catch(() => undefined);
      await rendition.display(initialCfi || undefined);
      if (cancelled) return;
      setReady(true);
      // Reading positions work without locations; percentages need them, so generate in the background.
      book.locations.generate(1024).catch(() => undefined);
    })().catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      drawn.clear();
      renditionRef.current?.destroy();
      bookRef.current?.destroy();
      renditionRef.current = bookRef.current = null;
      setReady(false);
    };
    // initialCfi is only the starting point; later position changes must not reload the book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storagePath]);

  // Reader settings: theme and text size apply live and are remembered on this device.
  useEffect(() => {
    const r = renditionRef.current;
    if (!r || !ready) return;
    r.themes.select(prefs.theme);
    r.themes.fontSize(`${prefs.fontSize}%`);
  }, [prefs, ready]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') void renditionRef.current?.next();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') void renditionRef.current?.prev();
      else return;
      e.preventDefault();
    }
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const r = renditionRef.current;
    if (!r || !ready) return;
    const wanted = new Map(highlights.map((h) => [h.cfi, h.color]));
    for (const [cfi, color] of painted.current) {
      if (wanted.get(cfi) !== color) {
        r.annotations.remove(cfi, 'highlight');
        painted.current.delete(cfi);
      }
    }
    for (const [cfi, color] of wanted) {
      if (!painted.current.has(cfi)) {
        r.annotations.highlight(cfi, {}, undefined, 'epub-highlight', { fill: color, 'fill-opacity': '0.4', 'mix-blend-mode': 'multiply' });
        painted.current.set(cfi, color);
      }
    }
  }, [highlights, ready]);

  useEffect(() => {
    if (goTo && ready) void renditionRef.current?.display(goTo);
  }, [goTo, ready]);

  function jumpToPercent() {
    const book = bookRef.current;
    const n = Number.parseFloat(percentDraft);
    if (!book || !Number.isFinite(n) || !book.locations.length()) return;
    void renditionRef.current?.display(book.locations.cfiFromPercentage(Math.min(100, Math.max(0, n)) / 100));
  }

  if (error) return <p className="text-body text-red">Could not load this file: {error}</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={!ready} onClick={() => void renditionRef.current?.prev()}>Previous</Button>
        <Button variant="secondary" disabled={!ready} onClick={() => void renditionRef.current?.next()}>Next</Button>
        {toc.length > 0 && (
          <select
            aria-label="Table of contents"
            className="max-w-[220px] rounded-8 border border-muted bg-dim p-3 text-body text-fg"
            value=""
            onChange={(e) => e.target.value && void renditionRef.current?.display(e.target.value)}
          >
            <option value="">Contents…</option>
            {toc.map((t) => <option key={`${t.href}:${t.label}`} value={t.href}>{`${' '.repeat(t.depth)}${t.label}`}</option>)}
          </select>
        )}
        <form className="flex items-center gap-1 text-small text-fg" onSubmit={(e) => { e.preventDefault(); jumpToPercent(); }}>
          <label className="flex items-center gap-1">
            Go to
            <input
              type="number"
              min={0}
              max={100}
              aria-label="Go to percent"
              placeholder={percent === null ? '%' : String(Math.round(percent))}
              value={percentDraft}
              onChange={(e) => setPercentDraft(e.target.value)}
              className="w-16 rounded-8 border border-muted bg-dim p-2 text-body text-fg"
            />
            %
          </label>
        </form>
        <Button variant="ghost" aria-label="Smaller text" onClick={() => updatePrefs({ fontSize: prefs.fontSize - 10 })}>A−</Button>
        <p className="text-small text-muted">{prefs.fontSize}%</p>
        <Button variant="ghost" aria-label="Larger text" onClick={() => updatePrefs({ fontSize: prefs.fontSize + 10 })}>A+</Button>
        <select aria-label="Reader theme" className="rounded-8 border border-muted bg-dim p-3 text-body text-fg" value={prefs.theme} onChange={(e) => updatePrefs({ theme: e.target.value as ReaderPrefs['theme'] })}>
          <option value="light">Light</option>
          <option value="sepia">Sepia</option>
          <option value="dark">Dark</option>
        </select>
        {!ready && <p className="text-small text-muted">Loading…</p>}
        {percent !== null && <p className="text-small text-muted">{Math.round(percent)}%</p>}
      </div>
      <div ref={hostRef} className="rounded-8 border border-border bg-white" />
    </div>
  );
}
