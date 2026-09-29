import { useEffect, useState } from 'react';

// NFR-PERF-1 is a server-time budget, not a reason to fire a query on every keystroke.
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
