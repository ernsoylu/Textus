import { useEffect, useRef } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';

const WIDTH = 96;

// FR-READ-11: a page overview. Thumbnails render only once scrolled into view, one at a time, so a 500-page
// PDF does not fetch or paint every page up front (pdf.js still range-loads only what each page needs).
export function PdfThumbnails({ doc, current, labels, onSelect }: Readonly<{ doc: PDFDocumentProxy; current: number; labels: string[] | null; onSelect: (page: number) => void }>) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let queue = Promise.resolve();
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const canvas = entry.target as HTMLCanvasElement;
        observer.unobserve(canvas);
        queue = queue.then(async () => {
          if (cancelled) return;
          const page = await doc.getPage(Number(canvas.dataset.page));
          const viewport = page.getViewport({ scale: (WIDTH * devicePixelRatio) / page.getViewport({ scale: 1 }).width });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          if (ctx && !cancelled) await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        }).catch(() => undefined);
      }
    }, { root: list.parentElement, rootMargin: '200px' });
    for (const canvas of list.querySelectorAll('canvas')) observer.observe(canvas);
    list.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'center' });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [doc]);

  return (
    <ol ref={listRef} aria-label="Pages" className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
      {Array.from({ length: doc.numPages }, (_, i) => i + 1).map((n) => (
        <li key={n}>
          <button
            type="button"
            aria-current={n === current ? 'page' : undefined}
            aria-label={`Page ${labels?.[n - 1] ?? n}`}
            onClick={() => onSelect(n)}
            className={`flex w-full flex-col items-center gap-1 rounded-8 p-1 text-small text-fg hover:bg-raised ${n === current ? 'bg-raised ring-2 ring-green' : ''}`}
          >
            <canvas data-page={n} width={96} height={125} className="h-auto w-24 bg-white shadow" />
            <span>{labels?.[n - 1] ?? n}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
