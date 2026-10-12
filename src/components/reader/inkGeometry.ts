import { INK_MAX_POINTS, type InkData } from '@/hooks/useAnnotations';

// FR-READ-10: stroke geometry in page fractions. x is a fraction of the page width, y of its height, and the
// stroke width a fraction of the width, so drawing at 50% and 200% stores the same numbers.
export type InkPoint = InkData['points'][number];

const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10_000) / 10_000;
// Closer points than this (in page fractions) add bytes but no visible detail.
const MIN_STEP = 0.0015;

/** Append a sample unless it is too close to the previous one or the stroke is full; returns whether it was kept. */
export function addPoint(points: InkPoint[], x: number, y: number, pressure?: number): boolean {
  if (points.length >= INK_MAX_POINTS) return false;
  const last = points.at(-1);
  if (last && Math.hypot(x - last[0], y - last[1]) < MIN_STEP) return false;
  points.push(pressure === undefined ? [round(x), round(y)] : [round(x), round(y), round(pressure)]);
  return true;
}

/** Stroke width in screen pixels for a page `w` px wide. Pressure (pen only) thickens or thins the whole stroke. */
export function strokeWidth(data: Pick<InkData, 'width' | 'points'>, w: number): number {
  const pressures = data.points.flatMap((p) => (p.length === 3 ? [p[2]] : []));
  const mean = pressures.length ? pressures.reduce((s, p) => s + p, 0) / pressures.length : 0.5;
  return Math.max(0.5, data.width * w * (0.5 + mean));
}

/** SVG path for points on a page of w × h px: quadratic curves through the midpoints, so strokes look smooth. */
export function strokePath(points: InkPoint[], w: number, h: number): string {
  if (!points.length) return '';
  const xy = points.map((p) => [p[0] * w, p[1] * h]);
  const f = (n: number) => n.toFixed(1);
  if (xy.length === 1) return `M${f(xy[0][0])} ${f(xy[0][1])}l0.01 0`;
  let d = `M${f(xy[0][0])} ${f(xy[0][1])}`;
  for (let i = 1; i < xy.length - 1; i++) {
    const mx = (xy[i][0] + xy[i + 1][0]) / 2;
    const my = (xy[i][1] + xy[i + 1][1]) / 2;
    d += `Q${f(xy[i][0])} ${f(xy[i][1])} ${f(mx)} ${f(my)}`;
  }
  const end = xy.at(-1)!;
  return `${d}L${f(end[0])} ${f(end[1])}`;
}

/** Whether a point (page fractions) is within `radius` (fraction of page width) of the stroke's line. */
export function touchesStroke(points: InkPoint[], x: number, y: number, radius: number, aspect: number): boolean {
  // Measure in width units: y is scaled by the page's height/width ratio so distances are round, not oval.
  const py = y * aspect;
  for (let i = 0; i < points.length; i++) {
    const ax = points[i][0];
    const ay = points[i][1] * aspect;
    const [bx, by] = i + 1 < points.length ? [points[i + 1][0], points[i + 1][1] * aspect] : [ax, ay];
    const len = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (py - ay) * (by - ay)) / len)) : 0;
    if (Math.hypot(x - (ax + t * (bx - ax)), py - (ay + t * (by - ay))) <= radius) return true;
  }
  return false;
}
