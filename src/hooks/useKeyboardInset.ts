import { useEffect, useState } from 'react';

// How much of the bottom of the layout viewport the on-screen keyboard (or collapsed browser chrome) covers,
// from visualViewport; 0 where the browser has no visualViewport. Bottom sheets lift themselves by this much.
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = globalThis.visualViewport;
    if (!vv) return;
    const update = () => setInset(Math.max(0, Math.round(globalThis.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}
