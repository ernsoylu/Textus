import { describe, expect, it } from 'vitest';
import { formatIssueRanges, parseIssueRanges } from './issueRanges';

describe('parseIssueRanges', () => {
  it('expands ranges and singles, in order, without duplicates', () => {
    expect(parseIssueRanges('1-3, 8, 2–4')).toEqual({ ok: true, numbers: [1, 2, 3, 4, 8] });
    expect(parseIssueRanges('')).toEqual({ ok: true, numbers: [] });
  });
  it('rejects nonsense with a reason', () => {
    expect(parseIssueRanges('1-x')).toMatchObject({ ok: false });
    expect(parseIssueRanges('5-2')).toMatchObject({ ok: false });
    expect(parseIssueRanges('0')).toMatchObject({ ok: false });
    expect(parseIssueRanges('1-5000')).toMatchObject({ ok: false });
  });
});

describe('formatIssueRanges', () => {
  it('collapses runs', () => {
    expect(formatIssueRanges([1, 2, 3, 5, 7, 8])).toBe('1–3, 5, 7–8');
    expect(formatIssueRanges([])).toBe('');
  });
});
