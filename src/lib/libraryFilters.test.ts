import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, parseFilters } from './libraryFilters';

describe('parseFilters', () => {
  it('falls back to empty filters on bad stored data', () => {
    expect(parseFilters({ sort: 'bogus' })).toEqual(EMPTY_FILTERS);
    expect(parseFilters({ tagId: 't1' }).tagId).toBe('t1');
  });
  it('defaults to date added and preserves an explicitly selected sort', () => {
    expect(EMPTY_FILTERS.sort).toBe('added');
    expect(parseFilters({ sort: 'title' }).sort).toBe('title');
  });
});
