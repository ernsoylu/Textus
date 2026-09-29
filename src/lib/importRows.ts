import { z } from 'zod';
import { parseIdentifier } from 'shared/identifier';
import { parseCsv } from '@/lib/csv';
import { WORK_TYPES } from '@/lib/recordTypes';

// FR-RES-3: turn pasted DOI lists and CSV text into validated import rows.
// CSV columns (header row required): title, authors (";"-separated), year, publisher, doi, isbn, type, language.
const ALIASES: Record<string, string> = { author: 'authors', date: 'year', work_type: 'type' };

const csvRowSchema = z.object({
  title: z.string().trim().min(1, 'title is required'),
  authors: z.string().trim().optional(),
  year: z.string().trim().regex(/^\d{4}$/, 'year must be 4 digits').optional().or(z.literal('')),
  publisher: z.string().trim().optional(),
  doi: z.string().trim().optional(),
  isbn: z.string().trim().optional(),
  type: z.enum(WORK_TYPES).default('book').or(z.literal('').transform(() => 'book' as const)),
  language: z.string().trim().optional(),
});
export type CsvImportRow = z.infer<typeof csvRowSchema>;

export interface RowError {
  line: number;
  message: string;
}

export function parseCsvImport(text: string): { rows: { line: number; data: CsvImportRow }[]; errors: RowError[] } {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], errors: [{ line: 1, message: 'The file is empty.' }] };
  const columns = header.map((h) => {
    const key = h.trim().toLowerCase();
    return ALIASES[key] ?? key;
  });
  if (!columns.includes('title')) return { rows: [], errors: [{ line: 1, message: 'The header row needs a "title" column.' }] };

  const rows: { line: number; data: CsvImportRow }[] = [];
  const errors: RowError[] = [];
  body.forEach((cells, i) => {
    const line = i + 2;
    const parsed = csvRowSchema.safeParse(Object.fromEntries(columns.map((c, n) => [c, cells[n] ?? ''])));
    if (!parsed.success) return errors.push({ line, message: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
    for (const scheme of ['doi', 'isbn'] as const) {
      const value = parsed.data[scheme];
      if (value && !parseIdentifier(scheme, value).ok) return errors.push({ line, message: `${scheme.toUpperCase()} "${value}" is not valid.` });
    }
    rows.push({ line, data: parsed.data });
  });
  return { rows, errors };
}

// One DOI per line; blank lines ignored, duplicates collapsed after normalization.
export function parseDoiList(text: string): { dois: string[]; errors: RowError[] } {
  const seen = new Set<string>();
  const dois: string[] = [];
  const errors: RowError[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim()) return;
    const parsed = parseIdentifier('doi', raw.trim());
    if (!parsed.ok) return errors.push({ line: i + 1, message: `"${raw.trim()}" is not a valid DOI.` });
    if (seen.has(parsed.normalized)) return;
    seen.add(parsed.normalized);
    dois.push(parsed.normalized);
  });
  return { dois, errors };
}
