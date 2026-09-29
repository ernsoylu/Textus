import { useEffect, useRef, useState } from 'react';
import ePub, { type Book, type Rendition } from 'epubjs';
import { supabase } from '@/lib/supabase';
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

export function EpubViewer({ storagePath, initialCfi, goTo, highlights, onProgress, onSelect }: Readonly<EpubViewerProps>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const painted = useRef(new Map<string, string>()); // cfi -> color already drawn
  const callbacks = useRef({ onProgress, onSelect });
  callbacks.current = { onProgress, onSelect };
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

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
      rendition.on('relocated', (loc: { start: { cfi: string } }) => {
        const fraction = book.locations.length() ? book.locations.percentageFromCfi(loc.start.cfi) : 0;
        callbacks.current.onProgress({ percentage: fraction * 100, position: { cfi: loc.start.cfi } });
      });
      rendition.on('selected', (cfiRange: string) => {
        const text = rendition.getRange(cfiRange)?.toString().trim();
        callbacks.current.onSelect(text ? { cfi: cfiRange, text } : null);
      });
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

  if (error) return <p className="text-body text-red">Could not load this file: {error}</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={!ready} onClick={() => void renditionRef.current?.prev()}>Previous</Button>
        <Button variant="secondary" disabled={!ready} onClick={() => void renditionRef.current?.next()}>Next</Button>
        {!ready && <p className="text-small text-muted">Loading…</p>}
      </div>
      <div ref={hostRef} className="rounded-8 border border-border bg-white" />
    </div>
  );
}
