import { describe, expect, it } from 'vitest';
import { applyFilters, EMPTY_FILTERS, parseFilters, type FilterableWork } from './libraryFilters';

const work = (id: string, over: Partial<FilterableWork> = {}): FilterableWork => ({
  workId: id, title: id, byline: '', workType: 'book', language: 'en', addedAt: '2026-01-01', publishedAt: null,
  tagIds: [], collectionIds: [], formats: [], statuses: ['unread'], lastReadAt: null, ...over,
});
const ids = (l: FilterableWork[]) => l.map((w) => w.workId);

describe('applyFilters', () => {
  const items = [
    work('a', { title: 'Beta', tagIds: ['t1'], formats: ['pdf'], statuses: ['reading'], addedAt: '2026-01-02', byline: 'Zed', publishedAt: '2000-01-01', lastReadAt: '2026-02-01' }),
    work('b', { title: 'Alpha', workType: 'paper', language: 'de', collectionIds: ['c1'], addedAt: '2026-01-03', byline: 'Amy' }),
    work('c', { title: 'Gamma', addedAt: '2026-01-01', publishedAt: '2010-01-01' }),
  ];

  it('filters on each facet', () => {
    expect(ids(applyFilters(items, { ...EMPTY_FILTERS, tagId: 't1' }))).toEqual(['a']);
    expect(ids(applyFilters(items, { ...EMPTY_FILTERS, workType: 'paper' }))).toEqual(['b']);
    expect(ids(applyFilters(items, { ...EMPTY_FILTERS, collectionId: 'c1' }))).toEqual(['b']);
    expect(ids(applyFilters(items, { ...EMPTY_FILTERS, status: 'reading' }))).toEqual(['a']);
    expect(ids(applyFilters(items, { ...EMPTY_FILTERS, format: 'pdf' }))).toEqual(['a']);
    expect(ids(applyFilters(items, { ...EMPTY_FILTERS, language: 'de' }))).toEqual(['b']);
  });

  it('sorts, with missing values last', () => {
    expect(ids(applyFilters(items, { ...EMPTY_FILTERS, sort: 'added' }))).toEqual(['b', 'a', 'c']);
    expect(ids(applyFilters(items, { ...EMPTY_FILTERS, sort: 'title' }))).toEqual(['b', 'a', 'c']);
    expect(ids(applyFilters(items, { ...EMPTY_FILTERS, sort: 'author' }))).toEqual(['b', 'a', 'c']);
    expect(ids(applyFilters(items, { ...EMPTY_FILTERS, sort: 'published' }))).toEqual(['c', 'a', 'b']);
    expect(ids(applyFilters(items, { ...EMPTY_FILTERS, sort: 'recent' }))).toEqual(['a', 'b', 'c']);
  });

  it('restricts to search hits and orders by rank', () => {
    const rank = new Map([['c', 0.9], ['a', 0.5]]);
    expect(ids(applyFilters(items, { ...EMPTY_FILTERS, q: 'x' }, rank))).toEqual(['c', 'a']);
  });
});

describe('parseFilters', () => {
  it('falls back to empty filters on bad stored data', () => {
    expect(parseFilters({ sort: 'bogus' })).toEqual(EMPTY_FILTERS);
    expect(parseFilters({ tagId: 't1' }).tagId).toBe('t1');
  });
});
