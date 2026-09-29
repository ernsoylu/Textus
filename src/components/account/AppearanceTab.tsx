import { useState } from 'react';
import { applyAppearance, loadAppearance, saveAppearance, TEXT_SIZES, type Appearance } from '@/lib/appearance';

const SELECT = 'rounded-8 border border-muted bg-dim p-3 text-body text-fg';

// Figma "appearance": each choice applies immediately and is remembered on this device.
export function AppearanceTab() {
  const [prefs, setPrefs] = useState<Appearance>(loadAppearance);

  function change(patch: Partial<Appearance>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    applyAppearance(next);
    saveAppearance(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-8 bg-green-bg p-3 text-small text-fg">Selected · Everforest Dark Medium</p>
      <label className="flex items-center justify-between gap-4 text-body text-fg">
        Text size
        <select aria-label="Text size" className={SELECT} value={prefs.textSize} onChange={(e) => change({ textSize: e.target.value as Appearance['textSize'] })}>
          {Object.entries(TEXT_SIZES).map(([id, t]) => <option key={id} value={id}>{t.label}</option>)}
        </select>
      </label>
      <label className="flex items-center justify-between gap-4 text-body text-fg">
        Library density
        <select aria-label="Library density" className={SELECT} value={prefs.density} onChange={(e) => change({ density: e.target.value as Appearance['density'] })}>
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>
      <label className="flex items-center justify-between gap-4 text-body text-fg">
        Motion
        <select aria-label="Motion" className={SELECT} value={prefs.motion} onChange={(e) => change({ motion: e.target.value as Appearance['motion'] })}>
          <option value="system">Respect device preference</option>
          <option value="reduce">Reduce motion</option>
        </select>
      </label>
      <div className="rounded-8 bg-raised p-4">
        <p className="font-serif text-heading text-fg">A library with room to think.</p>
        <p className="text-body text-muted">Preview: warm text, sage actions, soft charcoal-green surfaces.</p>
      </div>
      <p className="text-small text-muted">These settings apply on this device only.</p>
    </div>
  );
}
