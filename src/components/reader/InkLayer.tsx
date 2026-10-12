import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { inkFill, type InkData } from '@/hooks/useAnnotations';
import { addPoint, strokePath, strokeWidth, touchesStroke, type InkPoint } from './inkGeometry';
import type { InkSettings, InkStroke } from './types';

const ERASER_RADIUS = 0.012;

// FR-READ-10: pen and highlighter ink on one PDF page, as SVG in page pixels. Outside Mark mode it only draws.
// In Mark mode it takes input per the interaction contract (docs/READER_EXPERIENCE_RESEARCH.md):
//  - Apple Pencil (pointerType "pen") and the mouse draw; Pencil touches never scroll the page.
//  - A finger scrolls/zooms natively unless "Draw with finger" is on; then one finger draws and a second finger
//    cancels the unfinished stroke and hands over to pinch/pan.
//  - While a pen is down, touches (a resting palm) are ignored.
//  - A cancelled pointer or lost capture discards the unfinished stroke; a new stroke never joins an old one.
export function InkLayer({ page, strokes, settings, onStroke, onErase }: Readonly<{
  page: number;
  strokes: InkStroke[];
  settings: InkSettings | null;
  onStroke?: (data: InkData) => void;
  onErase?: (ids: string[]) => void;
}>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const liveRef = useRef<SVGPathElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [erasing, setErasing] = useState<Set<string>>(new Set());
  const gesture = useRef<{ id: number; type: string; points: InkPoint[]; erased: Set<string> } | null>(null);
  const touches = useRef(new Set<number>());
  const penDown = useRef(false);
  const cfg = useRef(settings);
  cfg.current = settings;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(() => setSize({ w: svg.clientWidth, h: svg.clientHeight }));
    observer.observe(svg);
    // Pencil input is also a touch to the browser: stop it scrolling while marking, but let fingers scroll.
    const stopStylusScroll = (e: TouchEvent) => {
      if (cfg.current && [...e.touches].some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus')) e.preventDefault();
    };
    svg.addEventListener('touchstart', stopStylusScroll, { passive: false });
    svg.addEventListener('touchmove', stopStylusScroll, { passive: false });
    return () => {
      observer.disconnect();
      svg.removeEventListener('touchstart', stopStylusScroll);
      svg.removeEventListener('touchmove', stopStylusScroll);
    };
  }, []);

  const toPage = (e: { clientX: number; clientY: number }) => {
    const box = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height, aspect: box.height / box.width };
  };

  const cancel = () => {
    gesture.current = null;
    liveRef.current?.setAttribute('d', '');
    setErasing(new Set());
  };

  const erase = (e: { clientX: number; clientY: number }) => {
    const g = gesture.current;
    if (!g) return;
    const { x, y, aspect } = toPage(e);
    const hit = strokes.filter((s) => !g.erased.has(s.id) && touchesStroke(s.data.points, x, y, ERASER_RADIUS + s.data.width / 2, aspect));
    if (!hit.length) return;
    for (const s of hit) g.erased.add(s.id);
    setErasing(new Set(g.erased));
  };

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    const s = cfg.current;
    if (!s) return;
    if (e.pointerType === 'touch') {
      touches.current.add(e.pointerId);
      if (!s.fingerDraw || penDown.current) return;
      // A second finger means navigation: drop the unfinished finger stroke.
      if (touches.current.size > 1) {
        if (gesture.current?.type === 'touch') cancel();
        return;
      }
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (gesture.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.pointerType === 'pen') penDown.current = true;
    gesture.current = { id: e.pointerId, type: e.pointerType, points: [], erased: new Set() };
    onPointerMove(e);
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId || !cfg.current) return;
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const sample of samples.length ? samples : [e.nativeEvent]) {
      if (cfg.current.tool === 'eraser') erase(sample);
      else {
        const { x, y } = toPage(sample);
        addPoint(g.points, x, y, g.type === 'pen' && sample.pressure > 0 ? sample.pressure : undefined);
      }
    }
    if (cfg.current.tool !== 'eraser') liveRef.current?.setAttribute('d', strokePath(g.points, size.w, size.h));
  }

  function onPointerEnd(e: ReactPointerEvent<SVGSVGElement>, commit: boolean) {
    touches.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (g.type === 'pen') penDown.current = false;
    const s = cfg.current;
    if (commit && s) {
      if (s.tool === 'eraser' && g.erased.size) onErase?.([...g.erased]);
      if (s.tool !== 'eraser' && g.points.length) onStroke?.({ v: 1, page, tool: s.tool, width: s.width, points: g.points });
    }
    gesture.current = null;
    liveRef.current?.setAttribute('d', '');
    setErasing(new Set());
  }

  const live = settings && settings.tool !== 'eraser' ? { ...settings, tool: settings.tool } : null;
  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 z-[6] h-full w-full"
      style={{ pointerEvents: settings ? 'auto' : 'none', touchAction: settings?.fingerDraw ? 'none' : 'pan-x pan-y', cursor: settings ? (settings.tool === 'eraser' ? 'cell' : 'crosshair') : undefined }}
      aria-hidden={settings ? undefined : true}
      aria-label={settings ? `Drawing surface, page ${page}` : undefined}
      role={settings ? 'img' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => onPointerEnd(e, true)}
      onPointerCancel={(e) => onPointerEnd(e, false)}
      onLostPointerCapture={(e) => onPointerEnd(e, false)}
    >
      {size.w > 0 && strokes.map((s) => (
        <path
          key={s.id}
          d={strokePath(s.data.points, size.w, size.h)}
          fill="none"
          stroke={inkFill(s.data.tool, s.color)}
          strokeWidth={strokeWidth(s.data, size.w)}
          strokeLinecap={s.data.tool === 'pen' ? 'round' : 'butt'}
          strokeLinejoin="round"
          opacity={(s.data.tool === 'highlighter' ? 0.45 : 1) * (erasing.has(s.id) ? 0.25 : 1)}
          style={s.data.tool === 'highlighter' ? { mixBlendMode: 'multiply' } : undefined}
          strokeDasharray={s.unsaved ? `${Math.max(2, s.data.width * size.w)} ${Math.max(2, s.data.width * size.w)}` : undefined}
        />
      ))}
      <path
        ref={liveRef}
        fill="none"
        stroke={live ? inkFill(live.tool, live.color) : 'none'}
        strokeWidth={live ? Math.max(0.5, live.width * size.w) : 0}
        strokeLinecap={live?.tool === 'pen' ? 'round' : 'butt'}
        strokeLinejoin="round"
        opacity={live?.tool === 'highlighter' ? 0.45 : 1}
      />
    </svg>
  );
}
