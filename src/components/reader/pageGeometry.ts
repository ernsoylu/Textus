import type { PageRect } from '@/hooks/useAnnotations';
import { touchesStroke, type InkPoint } from './inkGeometry';
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

/** Longest quote kept from a freehand highlight (matches the database trigger). */
export const INK_TEXT_MAX = 2000;

/**
 * FR-READ-10: the text a freehand highlighter stroke covers, in reading order, so the stroke becomes a findable
 * note like a text highlight. A character counts when its centre lies under the stroke's band (half its width
 * plus a little slack); `box` is the page content box the stroke's fractions refer to.
 */
export function textUnderStroke(layer: Element, box: DOMRectReadOnly, points: InkPoint[], width: number): string {
  if (!points.length || !box.width || !box.height) return '';
  const aspect = box.height / box.width;
  const radius = width / 2 + 0.003;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const pad = radius / Math.min(1, aspect);
  const [minX, maxX, minY, maxY] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
  const parts: string[] = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    if (!text.trim()) continue;
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if ((r.right - box.left) / box.width < minX || (r.left - box.left) / box.width > maxX || (r.bottom - box.top) / box.height < minY || (r.top - box.top) / box.height > maxY) continue;
    const covered = coveredText(node, text, range, box, points, radius, aspect);
    if (covered) parts.push(covered);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, INK_TEXT_MAX);
}

export function pageRectsOf(a: ViewerAnnotation, page: number): PageRect[] {
  return a.anchor.anchor_type === 'pdf_page' && a.anchor.anchor_data.page === page ? (a.anchor.anchor_data.rects ?? []) : [];
}

/** The most recent highlight on `page` under the point (x, y in page fractions), if any. */
export function hitTest(annotations: ViewerAnnotation[], page: number, x: number, y: number): ViewerAnnotation | undefined {
  return [...annotations].reverse().find((a) => pageRectsOf(a, page).some((r) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2));
}

function coveredText(node: Node, text: string, range: Range, box: DOMRectReadOnly, points: InkPoint[], radius: number, aspect: number): string {
  let first = -1;
  let last = -1;
  for (let i = 0; i < text.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const c = range.getBoundingClientRect();
    if (!c.width || !c.height) continue;
    const x = (c.left + c.width / 2 - box.left) / box.width;
    const y = (c.top + c.height / 2 - box.top) / box.height;
    if (touchesStroke(points, x, y, radius, aspect)) {
      if (first < 0) first = i;
      last = i;
    }
  }
  return first >= 0 ? text.slice(first, last + 1) : '';
}
