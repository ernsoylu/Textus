import { useCallback, useState } from 'react';
import { z } from 'zod';

// FR-READ: reader settings live in this browser only (localStorage), since they describe the device
// (screen, lighting), not the library. Storage can be unavailable (private mode), so every access is guarded.
const prefsSchema = z.object({
  fontSize: z.number().min(60).max(220).default(100),
  theme: z.enum(['light', 'sepia', 'dark']).default('light'),
  lineHeight: z.number().min(1).max(2.4).default(1.5),
  flow: z.enum(['paginated', 'scrolled']).default('paginated'),
  twoPage: z.boolean().default(false),
});
export type ReaderPrefs = z.infer<typeof prefsSchema>;
const KEY = 'textus.reader';

function load(): ReaderPrefs {
  try {
    return prefsSchema.parse(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return prefsSchema.parse({});
  }
}

export function useReaderPrefs() {
  const [prefs, setPrefs] = useState<ReaderPrefs>(load);
  const update = useCallback((patch: Partial<ReaderPrefs>) => {
    setPrefs((prev) => {
      const next = prefsSchema.parse({ ...prev, ...patch });
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable: the setting still applies for this session */
      }
      return next;
    });
  }, []);
  return [prefs, update] as const;
}
