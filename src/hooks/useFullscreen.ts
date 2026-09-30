import { useCallback, useEffect, useState, type RefObject } from 'react';

// Focused reading: the element fills the screen through the Fullscreen API. Where that API is missing
// (iPhone Safari) `active` still flips, and the caller pins the element over the page instead.
export function useFullscreen(ref: RefObject<HTMLElement>) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () => setActive(!!ref.current && document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [ref]);

  const toggle = useCallback(() => {
    if (!document.fullscreenEnabled) {
      setActive((a) => !a);
      return;
    }
    if (document.fullscreenElement) void document.exitFullscreen();
    else ref.current?.requestFullscreen().catch(() => setActive((a) => !a));
  }, [ref]);

  return [active, toggle] as const;
}
