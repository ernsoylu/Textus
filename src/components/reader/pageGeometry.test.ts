import { describe, expect, it } from 'vitest';
import { hitTest, textUnderStroke, toPageRects } from './pageGeometry';
import type { ViewerAnnotation } from './types';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRectReadOnly;

describe('toPageRects', () => {
  it('converts screen rectangles to page fractions, clipped to the page, dropping slivers', () => {
    const page = rect(100, 50, 200, 400);
    expect(toPageRects([rect(120, 90, 100, 20), rect(90, 50, 30, 20), rect(150, 60, 0.5, 10)], page)).toEqual([
      { x1: 0.1, y1: 0.1, x2: 0.6, y2: 0.15 },
      { x1: 0, y1: 0, x2: 0.1, y2: 0.05 },
    ]);
  });

  it('joins the pieces of one line into a single rectangle, keeping separate lines apart', () => {
    const page = rect(0, 0, 1000, 1000);
    expect(toPageRects([rect(100, 100, 100, 20), rect(205, 101, 100, 19), rect(310, 100, 50, 20), rect(100, 130, 200, 20)], page)).toEqual([
      { x1: 0.1, y1: 0.1, x2: 0.36, y2: 0.12 },
      { x1: 0.1, y1: 0.13, x2: 0.3, y2: 0.15 },
    ]);
  });
});

describe('hitTest', () => {
  const ann = (id: string, page: number, x1: number, y1: number, x2: number, y2: number): ViewerAnnotation => ({
    id, color: 'yellow', note: null, anchor: { anchor_type: 'pdf_page', anchor_data: { page, rects: [{ x1, y1, x2, y2 }] } },
  });
  const list = [ann('a', 1, 0.1, 0.1, 0.5, 0.2), ann('b', 1, 0.3, 0.1, 0.9, 0.2), ann('c', 2, 0, 0, 1, 1)];

  it('finds the newest highlight under the point on that page only', () => {
    expect(hitTest(list, 1, 0.2, 0.15)?.id).toBe('a');
    expect(hitTest(list, 1, 0.4, 0.15)?.id).toBe('b');
    expect(hitTest(list, 1, 0.4, 0.5)).toBeUndefined();
    expect(hitTest(list, 2, 0.4, 0.5)?.id).toBe('c');
  });
});

describe('textUnderStroke', () => {
  it('returns the characters under a freehand highlighter band, in reading order', () => {
    // A fake text layer: each character is 10 px wide; line 1 at y 0–20, line 2 at y 40–60 on a 200 × 100 page.
    const layer = document.createElement('div');
    layer.innerHTML = '<span>Hello world</span><span>second line</span>';
    const lineOf = (node: Node) => (node.textContent === 'Hello world' ? 0 : 1);
    const original = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = function (this: Range) {
      const node = this.startContainer.nodeType === Node.TEXT_NODE ? this.startContainer : this.startContainer.firstChild!;
      const whole = this.startContainer.nodeType !== Node.TEXT_NODE;
      const start = whole ? 0 : this.startOffset;
      const end = whole ? (node.textContent ?? '').length : this.endOffset;
      const top = lineOf(node) * 40;
      return new DOMRect(start * 10, top, (end - start) * 10, 20);
    };
    try {
      const box = new DOMRect(0, 0, 200, 100);
      // A stroke across "world" on line 1 (x 60–110 px, y 10 px).
      expect(textUnderStroke(layer, box, [[0.3, 0.1], [0.55, 0.1]], 0.02)).toBe('world');
      // Down across both lines at the "o" / "l" column covers one character of each.
      expect(textUnderStroke(layer, box, [[0.375, 0.05], [0.375, 0.55]], 0.01)).toBe('o l');
      expect(textUnderStroke(layer, box, [[0.9, 0.9]], 0.01)).toBe('');
    } finally {
      Range.prototype.getBoundingClientRect = original;
    }
  });
});
