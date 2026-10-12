import { Fragment } from 'react';
import { COMMENT_ICON_PATH, pageRectsOf } from './pageGeometry';
import type { Point, ViewerAnnotation } from './types';

// Highlights and comment markers on one fixed page (PDF, DjVu). Sits over the page image; highlights let
// clicks and selection through, while a note gets a small marker in the right margin, like a comment in Word.
// Markers have 44 px hit boxes (NFR-A11Y-2); markers on nearby lines are pushed down so their boxes don't overlap.
export function PageOverlay({ page, annotations, onOpen }: Readonly<{ page: number; annotations: ViewerAnnotation[]; onOpen?: (id: string, at: Point) => void }>) {
  const onPage = annotations.filter((a) => a.anchor.anchor_type === 'pdf_page' && a.anchor.anchor_data.page === page);
  // Stack markers whose lines are within ~3% of the page height of each other.
  const shift = new Map<string, number>();
  let prev = -1;
  let stack = 0;
  for (const a of onPage.filter((x) => x.note || !pageRectsOf(x, page).length).sort((x, y) => (pageRectsOf(x, page)[0]?.y1 ?? 0) - (pageRectsOf(y, page)[0]?.y1 ?? 0))) {
    const y = pageRectsOf(a, page)[0]?.y1 ?? 0;
    stack = prev >= 0 && y - prev < 0.03 ? stack + 1 : 0;
    shift.set(a.id, stack);
    prev = y;
  }
  return (
    <div className="pointer-events-none absolute inset-0 z-[5]">
      {onPage.map((a, n) => {
        const rects = pageRectsOf(a, page);
        const top = rects[0] ? `calc(${rects[0].y1 * 100}% - 14px + ${(shift.get(a.id) ?? 0) * 44}px)` : `${n * 44}px`;
        return (
          <Fragment key={a.id}>
            {rects.map((r, i) => (
              <span
                key={i}
                data-textus-note={a.id}
                className="absolute"
                style={{ left: `${r.x1 * 100}%`, top: `${r.y1 * 100}%`, width: `${(r.x2 - r.x1) * 100}%`, height: `${(r.y2 - r.y1) * 100}%`, backgroundColor: a.color, opacity: 0.5, mixBlendMode: 'multiply' }}
              />
            ))}
            {(a.note || !rects.length) && (
              <button
                type="button"
                title={a.note ?? 'Page note'}
                aria-label={a.note ? `Comment: ${a.note.slice(0, 80)}` : 'Page note'}
                onClick={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  onOpen?.(a.id, { x: box.left, y: box.bottom });
                }}
                className="pointer-events-auto absolute right-0 flex h-11 w-11 items-center justify-center"
                style={{ top }}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-4 shadow" style={{ backgroundColor: a.color }}>
                  <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d={COMMENT_ICON_PATH} fill="#fff" stroke="#232a2e" strokeWidth="1" /></svg>
                </span>
              </button>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
