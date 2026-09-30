import type { PageRect } from '@/hooks/useAnnotations';
import type { ViewerAnnotation } from './types';

// Fixed-page formats (PDF, DjVu) anchor highlights as rectangles in page fractions (0–1), so they stay put at
// any zoom. These helpers convert between screen rectangles and those fractions.
/** A speech bubble in a 16×16 box: the comment marker drawn next to annotated text in every viewer. */
export const COMMENT_ICON_PATH = 'M2.5 2h11A1.5 1.5 0 0 1 15 3.5v7a1.5 1.5 0 0 1-1.5 1.5H7l-3.5 3v-3h-1A1.5 1.5 0 0 1 1 10.5v-7A1.5 1.5 0 0 1 2.5 2z';

const round =(n: number) => Math.round(n * 10_000) / 10_000;

export function toPageRects(rects: Iterable<DOMRectReadOnly>, page: DOMRectReadOnly): PageRect[] {
  return [...rects]
    .filter((r) => r.width > 1 && r.height > 1)
    .map((r) => ({
      x1: round(Math.max(0, (r.left - page.left) / page.width)),
      y1: round(Math.max(0, (r.top - page.top) / page.height)),
      x2: round(Math.min(1, (r.right - page.left) / page.width)),
      y2: round(Math.min(1, (r.bottom - page.top) / page.height)),
    }))
    .filter((r) => r.x2 > r.x1 && r.y2 > r.y1)
    .reduce<PageRect[]>((lines, r) => {
      // pdf.js splits a line into many spans: join pieces of one line (mostly overlapping vertically, touching).
      const last = lines.at(-1);
      const overlap = last ? Math.min(last.y2, r.y2) - Math.max(last.y1, r.y1) : 0;
      if (last && overlap > 0.5 * Math.min(last.y2 - last.y1, r.y2 - r.y1) && r.x1 <= last.x2 + 0.02 && r.x2 >= last.x1) {
        lines[lines.length - 1] = { x1: Math.min(last.x1, r.x1), y1: Math.min(last.y1, r.y1), x2: Math.max(last.x2, r.x2), y2: Math.max(last.y2, r.y2) };
      } else lines.push(r);
      return lines;
    }, [])
    .slice(0, 200);
}

/**
 * Screen rectangles of the selected text only. A range's own getClientRects() also returns the boxes of every
 * element it passes over — in pdf.js' text layer that is whole empty spans on other lines.
 */
export function textRects(range: Range): DOMRect[] {
  const root = range.commonAncestorContainer;
  const walker = document.createTreeWalker(root.nodeType === Node.TEXT_NODE ? (root.parentNode ?? root) : root, NodeFilter.SHOW_TEXT);
  const rects: DOMRect[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node) || !node.textContent?.trim()) continue;
    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    rects.push(...part.getClientRects());
  }
  return rects;
}

export function pageRectsOf(a: ViewerAnnotation, page: number): PageRect[] {
  return a.anchor.anchor_type === 'pdf_page' && a.anchor.anchor_data.page === page ? (a.anchor.anchor_data.rects ?? []) : [];
}

/** The most recent highlight on `page` under the point (x, y in page fractions), if any. */
export function hitTest(annotations: ViewerAnnotation[], page: number, x: number, y: number): ViewerAnnotation | undefined {
  return [...annotations].reverse().find((a) => pageRectsOf(a, page).some((r) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2));
}
