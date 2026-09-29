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
  it('uses the expected run so a missing last issue is caught', () => {
    const r = serialCompleteness([{ volume: '2024', issue_number: '1' }, { volume: '2024', issue_number: '2' }], { '2024': '1-4' });
    expect(r.volumes[0]).toMatchObject({ have: [1, 2], expected: [1, 2, 3, 4], missing: [3, 4], max: 4 });
  });
  it('lists issues held outside the expected run, and shows expected volumes with nothing held yet', () => {
    const r = serialCompleteness([{ volume: '2023', issue_number: '9' }], { '2023': '1-3', '2025': '1-2' });
    expect(r.volumes.find((v) => v.volume === '2023')).toMatchObject({ extra: [9], missing: [1, 2, 3] });
    expect(r.volumes.find((v) => v.volume === '2025')).toMatchObject({ have: [], missing: [1, 2] });
  });
});
