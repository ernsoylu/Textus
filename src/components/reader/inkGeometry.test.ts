import { describe, expect, it } from 'vitest';
import { INK_MAX_POINTS, anchorSchema } from '@/hooks/useAnnotations';
import { addPoint, strokePath, strokeWidth, touchesStroke, type InkPoint } from './inkGeometry';

describe('ink geometry', () => {
  it('drops samples that add no detail and stops at the point limit', () => {
    const points: InkPoint[] = [];
    expect(addPoint(points, 0.1, 0.1)).toBe(true);
    expect(addPoint(points, 0.1001, 0.1)).toBe(false);
    expect(addPoint(points, 0.2, 0.123456, 0.7)).toBe(true);
    expect(points).toEqual([[0.1, 0.1], [0.2, 0.1235, 0.7]]);
    const full: InkPoint[] = Array.from({ length: INK_MAX_POINTS }, () => [0, 0]);
    expect(addPoint(full, 0.5, 0.5)).toBe(false);
  });

  it('clamps samples to the page', () => {
    const points: InkPoint[] = [];
    addPoint(points, -0.2, 1.4);
    expect(points).toEqual([[0, 1]]);
  });

  it('draws paths in screen pixels at any page size', () => {
    expect(strokePath([[0, 0], [0.5, 0.5], [1, 1]], 100, 200)).toBe('M0.0 0.0Q50.0 100.0 75.0 150.0L100.0 200.0');
    expect(strokePath([[0.5, 0.5]], 10, 10)).toBe('M5.0 5.0l0.01 0');
  });

  it('scales the width with the page and with pen pressure', () => {
    expect(strokeWidth({ width: 0.004, points: [[0, 0]] }, 1000)).toBe(4);
    expect(strokeWidth({ width: 0.004, points: [[0, 0, 1]] }, 1000)).toBe(6);
  });

  it('finds strokes under the eraser on a non-square page', () => {
    const line: InkPoint[] = [[0.1, 0.5], [0.9, 0.5]];
    expect(touchesStroke(line, 0.5, 0.507, 0.01, 1.3)).toBe(true);
    expect(touchesStroke(line, 0.5, 0.51, 0.01, 1.3)).toBe(false);
    expect(touchesStroke(line, 0.95, 0.5, 0.01, 1.3)).toBe(false);
  });

  it('validates stored strokes at the trust boundary', () => {
    const ok = { anchor_type: 'pdf_ink', anchor_data: { v: 1, page: 2, tool: 'pen', width: 0.004, points: [[0.1, 0.2], [0.3, 0.4, 0.5]] } };
    expect(anchorSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok.anchor_data, points: [[1.2, 0]] },
      { ...ok.anchor_data, points: [] },
      { ...ok.anchor_data, tool: 'marker' },
      { ...ok.anchor_data, width: 1 },
      { ...ok.anchor_data, v: 2 },
      { ...ok.anchor_data, points: Array.from({ length: INK_MAX_POINTS + 1 }, () => [0, 0]) },
    ]) expect(anchorSchema.safeParse({ anchor_type: 'pdf_ink', anchor_data: bad }).success).toBe(false);
  });
});
