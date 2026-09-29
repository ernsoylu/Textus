// "yesterday", "3 hours ago" — for "Last read …". `now` is injectable for tests.
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

export function relativeTime(iso: string, now = Date.now(), locale = 'en'): string {
  const diff = Date.parse(iso) - now;
  if (Number.isNaN(diff)) return '';
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return formatter.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

// Good morning / afternoon / evening, by the viewer's local hour.
export function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  return hour < 18 ? 'Good afternoon' : 'Good evening';
}
