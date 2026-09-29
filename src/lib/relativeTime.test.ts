import { describe, expect, it } from 'vitest';
import { greeting, relativeTime } from './relativeTime';

const NOW = Date.parse('2026-09-29T12:00:00Z');

describe('relativeTime', () => {
  it('speaks in the largest sensible unit', () => {
    expect(relativeTime('2026-09-28T12:00:00Z', NOW)).toBe('yesterday');
    expect(relativeTime('2026-09-29T09:00:00Z', NOW)).toBe('3 hours ago');
    expect(relativeTime('2026-09-29T11:59:30Z', NOW)).toBe('just now');
    expect(relativeTime('2026-09-01T12:00:00Z', NOW)).toBe('4 weeks ago');
  });
  it('is empty for a bad date', () => {
    expect(relativeTime('not a date', NOW)).toBe('');
  });
});

describe('greeting', () => {
  it('follows the hour', () => {
    expect([greeting(6), greeting(13), greeting(21)]).toEqual(['Good morning', 'Good afternoon', 'Good evening']);
  });
});
