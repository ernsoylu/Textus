// FR-SER-2: volume/issue completeness for a serial. Issues are expected to run 1..max within a
// volume, where max is the highest numeric issue held; anything else is listed as unnumbered.
// ponytail: no per-serial expected counts, so a missing *last* issue cannot be detected; add an
// "expected issues per volume" field if that matters.
export interface IssueRef {
  volume: string | null;
  issue_number: string | null;
}

export interface VolumeCompleteness {
  volume: string; // '' when the issues carry no volume
  have: number[];
  missing: number[];
  max: number;
}

export interface SerialCompleteness {
  volumes: VolumeCompleteness[];
  unnumbered: number;
}

export function serialCompleteness(issues: IssueRef[]): SerialCompleteness {
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
  const volumes = [...byVolume]
    .map(([volume, set]): VolumeCompleteness => {
      const have = [...set].sort((a, b) => a - b);
      const max = have.at(-1)!;
      return { volume, have, max, missing: Array.from({ length: max }, (_, i) => i + 1).filter((n) => !set.has(n)) };
    })
    .sort((a, b) => a.volume.localeCompare(b.volume, undefined, { numeric: true }));
  return { volumes, unnumbered };
}
