import { describe, expect, it } from 'vitest';
import { serialCompleteness } from './serialCompleteness';

describe('serialCompleteness', () => {
  it('finds gaps per volume and orders volumes numerically', () => {
    const r = serialCompleteness([
      { volume: '10', issue_number: '1' }, { volume: '2', issue_number: '1' }, { volume: '2', issue_number: '4' }, { volume: '2', issue_number: '2' },
    ]);
    expect(r.volumes.map((v) => v.volume)).toEqual(['2', '10']);
    expect(r.volumes[0]).toMatchObject({ have: [1, 2, 4], missing: [3], max: 4 });
    expect(r.volumes[1].missing).toEqual([]);
  });
  it('counts non-numeric and missing issue numbers as unnumbered', () => {
    expect(serialCompleteness([{ volume: null, issue_number: 'Spring' }, { volume: null, issue_number: null }, { volume: null, issue_number: '2' }])).toMatchObject({ unnumbered: 2, volumes: [{ volume: '', missing: [1] }] });
  });
});
