import { useEffect, useRef, type RefObject } from 'react';

// FR-READ-8: two-finger pinch zoom and pan for fixed-page viewers. While the fingers move, `content` is scaled
// with a CSS transform around the pinch centre (cheap preview); on release `commit` applies the real scale,
// keeping the point under the fingers in place. Touch events, not pointer events, so one-finger scrolling stays
// native (touch-action: pan-x pan-y on the scroller) and Safari's own page zoom is suppressed only inside it.
export interface PinchCommit {
  /** Ratio of the new scale to the scale at the start of the pinch. */
  factor: number;
  /** Pinch centre in client coordinates. */
  origin: [number, number];
}

export function usePinchZoom(scroller: RefObject<HTMLElement>, content: RefObject<HTMLElement>, commit: (c: PinchCommit) => void, enabled = true) {
  const cb = useRef(commit);
  cb.current = commit;

  useEffect(() => {
    const el = scroller.current;
    if (!el || !enabled) return;
    let start: { distance: number; mid: [number, number]; scroll: [number, number] } | null = null;
    let last: { factor: number; mid: [number, number] } | null = null;

    const geometry = (t: TouchList) => {
      const [a, b] = [t[0], t[1]];
      return { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mid: [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2] as [number, number] };
    };
    const reset = () => {
      if (content.current) content.current.style.transform = '';
      start = null;
      last = null;
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const g = geometry(e.touches);
      start = { ...g, scroll: [el.scrollLeft, el.scrollTop] };
      last = { factor: 1, mid: g.mid };
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      const g = geometry(e.touches);
      const factor = Math.min(8, Math.max(0.125, g.distance / start.distance));
      last = { factor, mid: g.mid };
      const box = el.getBoundingClientRect();
      const node = content.current;
      if (!node) return;
      // Origin in the content's own box: the starting pinch centre plus how far it was scrolled.
      const ox = start.scroll[0] + start.mid[0] - box.left - node.offsetLeft;
      const oy = start.scroll[1] + start.mid[1] - box.top - node.offsetTop;
      node.style.transformOrigin = `${ox}px ${oy}px`;
      node.style.transform = `translate(${g.mid[0] - start.mid[0]}px, ${g.mid[1] - start.mid[1]}px) scale(${factor})`;
    };
    const onEnd = (e: TouchEvent) => {
      if (!start || !last || e.touches.length >= 2) return;
      const { factor, mid } = last;
      const pan: [number, number] = [mid[0] - start.mid[0], mid[1] - start.mid[1]];
      reset();
      if (pan[0] || pan[1]) el.scrollBy(-pan[0], -pan[1]);
      if (Math.abs(factor - 1) > 0.02) cb.current({ factor, origin: mid });
    };
    // Safari's proprietary gesture events would zoom the whole page.
    const block = (e: Event) => e.preventDefault();
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', reset);
    el.addEventListener('gesturestart', block);
    el.addEventListener('gesturechange', block);
    return () => {
      reset();
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', reset);
      el.removeEventListener('gesturestart', block);
      el.removeEventListener('gesturechange', block);
    };
  }, [scroller, content, enabled]);
}
