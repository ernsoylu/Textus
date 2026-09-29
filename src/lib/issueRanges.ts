// FR-SER-2: the run of issue numbers a collector expects for a volume, typed as "1-12" or "1-6, 8, 10-12"
// (Figma "expected issues"). Stored as that text in works.metadata.expected_issues[volume].
export type RangeResult = { ok: true; numbers: number[] } | { ok: false; message: string };

const MAX_ISSUES = 1000;

export function parseIssueRanges(text: string): RangeResult {
  const numbers = new Set<number>();
  for (const part of text.split(',').map((p) => p.trim()).filter(Boolean)) {
    const match = /^(\d+)\s*(?:[-–—]\s*(\d+))?$/.exec(part);
    if (!match) return { ok: false, message: `“${part}” is not an issue number or range. Use forms like 1-12 or 1-6, 8.` };
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to < from) return { ok: false, message: `“${part}” is not a valid range.` };
    if (to - from + 1 + numbers.size > MAX_ISSUES) return { ok: false, message: `That is more than ${MAX_ISSUES} issues.` };
    for (let n = from; n <= to; n++) numbers.add(n);
  }
  return { ok: true, numbers: [...numbers].sort((a, b) => a - b) };
}

// [1,2,3,5] -> "1–3, 5"
export function formatIssueRanges(numbers: number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < numbers.length) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j++;
    parts.push(j > i ? `${numbers[i]}–${numbers[j]}` : String(numbers[i]));
    i = j + 1;
  }
  return parts.join(', ');
}
