import { Fragment } from 'react';
import { COMMENT_ICON_PATH, pageRectsOf } from './pageGeometry';
import type { Point, ViewerAnnotation } from './types';

// Highlights and comment markers on one fixed page (PDF, DjVu). Sits over the page image; highlights let
// clicks and selection through, while a note gets a small marker in the right margin, like a comment in Word.
export function PageOverlay({ page, annotations, onOpen }: Readonly<{ page: number; annotations: ViewerAnnotation[]; onOpen?: (id: string, at: Point) => void }>) {
  const onPage = annotations.filter((a) => a.anchor.anchor_type === 'pdf_page' && a.anchor.anchor_data.page === page);
  return (
    <div className="pointer-events-none absolute inset-0 z-[5]">
      {onPage.map((a, n) => {
        const rects = pageRectsOf(a, page);
        const top = rects[0] ? `calc(${rects[0].y1 * 100}% - 4px)` : `${8 + n * 26}px`;
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
                className="pointer-events-auto absolute right-1 flex h-6 w-6 items-center justify-center rounded-4 shadow"
                style={{ top, backgroundColor: a.color }}
              >
                <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true"><path d={COMMENT_ICON_PATH} fill="#fff" stroke="#232a2e" strokeWidth="1" /></svg>
              </button>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
