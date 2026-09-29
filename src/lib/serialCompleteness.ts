import { parseIssueRanges } from '@/lib/issueRanges';

// FR-SER-2: volume/issue completeness for a serial. Where the collector has said which issue numbers they
// expect for a volume (works.metadata.expected_issues, e.g. "1-12"), missing = expected − held, so a missing
// last issue is caught. Otherwise issues are assumed to run 1..max of what is held.
export interface IssueRef {
  volume: string | null;
  issue_number: string | null;
}

export interface VolumeCompleteness {
  volume: string; // '' when the issues carry no volume
  have: number[];
  expected: number[] | null; // null: no expectation set, 1..max is assumed
  missing: number[];
  extra: number[]; // held but outside the expected run
  max: number;
}

export interface SerialCompleteness {
  volumes: VolumeCompleteness[];
  unnumbered: number;
}

export type ExpectedIssues = Record<string, string>;

export function serialCompleteness(issues: IssueRef[], expectedIssues: ExpectedIssues = {}): SerialCompleteness {
  const byVolume = new Map<string, Set<number>>();
  let unnumbered = 0;
  for (const issue of issues) {
    const n = /^\d+$/.test(issue.issue_number?.trim() ?? '') ? Number(issue.issue_number!.trim()) : null;
    if (n === null || n < 1) {
      unnumbered++;
      continue;
    }
    const volume = issue.volume?.trim() ?? '';
    byVolume.set(volume, (byVolume.get(volume) ?? new Set()).add(n));
  }
  // A volume with an expectation but no issues yet still shows up, all of it missing.
  for (const volume of Object.keys(expectedIssues)) if (!byVolume.has(volume)) byVolume.set(volume, new Set());

  const volumes = [...byVolume]
    .map(([volume, set]): VolumeCompleteness => {
      const have = [...set].sort((a, b) => a - b);
      const parsed = expectedIssues[volume] === undefined ? null : parseIssueRanges(expectedIssues[volume]);
      const expected = parsed?.ok && parsed.numbers.length ? parsed.numbers : null;
      const max = Math.max(0, ...have, ...(expected ?? []));
      const want = expected ?? Array.from({ length: have.at(-1) ?? 0 }, (_, i) => i + 1);
      return { volume, have, expected, max, missing: want.filter((n) => !set.has(n)), extra: expected ? have.filter((n) => !expected.includes(n)) : [] };
    })
    .sort((a, b) => a.volume.localeCompare(b.volume, undefined, { numeric: true }));
  return { volumes, unnumbered };
}

// works.metadata.expected_issues: { "<volume or year>": "1-12" }. Anything malformed is ignored.
export function readExpectedIssues(metadata: unknown): ExpectedIssues {
  const raw = metadata && typeof metadata === 'object' ? (metadata as { expected_issues?: unknown }).expected_issues : undefined;
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
}
