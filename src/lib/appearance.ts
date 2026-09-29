import { z } from 'zod';

// Figma "appearance": text size, library density and motion. Stored per device (localStorage), since they
// describe the screen and the person's comfort, not the library. The theme itself is fixed
// (Everforest Dark Medium is the only one designed).
export const TEXT_SIZES = { small: { label: 'Small · 14px', scale: 14 / 16 }, comfortable: { label: 'Comfortable · 16px', scale: 1 }, large: { label: 'Large · 18px', scale: 18 / 16 } } as const;

export const appearanceSchema = z.object({
  textSize: z.enum(['small', 'comfortable', 'large']).default('comfortable'),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  motion: z.enum(['system', 'reduce']).default('system'),
});
export type Appearance = z.infer<typeof appearanceSchema>;

const KEY = 'textus.appearance';

export function loadAppearance(): Appearance {
  try {
    return appearanceSchema.parse(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return appearanceSchema.parse({});
  }
}

export function saveAppearance(next: Appearance): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: the choice still applies for this session */
  }
}

// `zoom` scales text and layout together and is supported by every current browser.
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement): void {
  root.style.setProperty('zoom', String(TEXT_SIZES[a.textSize].scale));
  root.dataset.textSize = a.textSize;
  root.dataset.density = a.density;
  root.dataset.motion = a.motion;
}
