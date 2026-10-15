import { describe, expect, it } from 'vitest';
import { fetchAllPages, unmatchedProvisional, type ContributorListItem } from './useContributors';

describe('fetchAllPages', () => {
  it('keeps requesting 1000-row pages until a short page', async () => {
    const all = Array.from({ length: 2500 }, (_, i) => i);
    const ranges: [number, number][] = [];
    const rows = await fetchAllPages(async (from, to) => { ranges.push([from, to]); return { data: all.slice(from, to + 1), error: null }; });
    expect(rows).toEqual(all);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('throws the page error', async () => {
    await expect(fetchAllPages(async () => ({ data: null, error: new Error('boom') }))).rejects.toThrow('boom');
  });
});

describe('unmatchedProvisional', () => {
  const c = (id: string, status: string) => ({ id, status }) as ContributorListItem;
  it('returns provisional contributors that are in no duplicate pair', () => {
    const contributors = [c('a', 'provisional'), c('b', 'confirmed'), c('d', 'provisional'), c('e', 'provisional')];
    expect(unmatchedProvisional(contributors, [{ a: { id: 'a' }, b: { id: 'b' } }])).toEqual(['d', 'e']);
  });
});
