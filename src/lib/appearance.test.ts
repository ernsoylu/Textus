import { describe, expect, it } from 'vitest';
import { appearanceSchema, applyAppearance, loadAppearance, saveAppearance } from './appearance';

describe('appearance', () => {
  it('defaults to comfortable, system motion', () => {
    expect(appearanceSchema.parse({})).toEqual({ textSize: 'comfortable', density: 'comfortable', motion: 'system' });
  });
  it('falls back to defaults on bad stored data, and round-trips a saved choice', () => {
    localStorage.setItem('textus.appearance', '{"textSize":"huge"}');
    expect(loadAppearance().textSize).toBe('comfortable');
    saveAppearance({ textSize: 'large', density: 'compact', motion: 'reduce' });
    expect(loadAppearance()).toEqual({ textSize: 'large', density: 'compact', motion: 'reduce' });
  });
  it('applies to the root element', () => {
    const root = document.createElement('html');
    applyAppearance({ textSize: 'small', density: 'compact', motion: 'reduce' }, root);
    expect(root.dataset.density).toBe('compact');
    expect(root.dataset.motion).toBe('reduce');
    expect(root.dataset.textSize).toBe('small');
  });
});
