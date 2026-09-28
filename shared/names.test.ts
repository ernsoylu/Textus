import { describe, it, expect } from 'vitest';
import { formatByline, type Credit } from './names';

function credit(role: string, position: number, display_name: string, credited_as: string | null = null): Credit {
  return { role, position, credited_as, display_name };
}

describe('formatByline (FR-CONTRIB-4)', () => {
  it('joins two authors with an ampersand', () => {
    expect(formatByline([credit('author', 0, 'Ann'), credit('author', 1, 'Bea')])).toBe('Ann & Bea');
  });

  it('joins three or more with commas and a final ampersand', () => {
    expect(
      formatByline([credit('author', 0, 'Ann'), credit('author', 1, 'Bea'), credit('author', 2, 'Cid')]),
    ).toBe('Ann, Bea & Cid');
  });

  it('prefers credited_as over the contributor display name', () => {
    expect(formatByline([credit('author', 0, 'J. R. R. Tolkien', 'Tolkien')])).toBe('Tolkien');
  });

  it('falls back to editors when there are no authors', () => {
    expect(formatByline([credit('editor', 0, 'Ed One')])).toBe('Ed One (ed.)');
  });

  it('falls back to compilers, then translators, in that order', () => {
    const credits = [credit('translator', 0, 'Trans'), credit('compiler', 0, 'Comp')];
    expect(formatByline(credits)).toBe('Comp (comp.)');
    expect(formatByline([credit('translator', 0, 'Trans')])).toBe('Trans (trans.)');
  });

  it('ignores roles below the highest present in the fallback order', () => {
    const credits = [credit('author', 0, 'Ann'), credit('editor', 0, 'Ed')];
    expect(formatByline(credits)).toBe('Ann');
  });

  it('returns an empty string with no credits', () => {
    expect(formatByline([])).toBe('');
  });
});
