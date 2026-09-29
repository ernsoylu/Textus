import { z } from 'zod';
import { parseIdentifier } from 'shared/identifier';
import { parseCsv } from '@/lib/csv';
import { WORK_TYPES } from '@/lib/recordTypes';

// FR-RES-3: turn pasted DOI lists and CSV text into validated import rows.
// CSV columns are matched to import fields by the user (Figma "csv map"); the header names only seed the guess.
export const IMPORT_FIELDS = ['title', 'authors', 'year', 'publisher', 'doi', 'isbn', 'type', 'language', 'tags'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const FIELD_LABELS: Record<ImportField, string> = {
  title: 'Title',
  authors: 'Contributor names',
  year: 'Publication year',
  publisher: 'Publisher',
  doi: 'DOI identifier',
  isbn: 'ISBN identifier',
  type: 'Work type',
  language: 'Language',
  tags: 'Tags',
};

// Header names (lowercased) that map to each field, besides the field's own name.
const HEADER_ALIASES: Record<string, ImportField> = {
  name: 'title', 'book title': 'title', 'paper title': 'title',
  author: 'authors', creator: 'authors', creators: 'authors', by: 'authors', 'author name': 'authors', 'author names': 'authors',
  date: 'year', published: 'year', 'publication year': 'year', 'pub year': 'year', 'year published': 'year',
  'isbn number': 'isbn', isbn13: 'isbn', 'isbn-13': 'isbn', 'isbn 13': 'isbn', 'doi number': 'doi',
  work_type: 'type', 'work type': 'type',
  tag: 'tags', labels: 'tags', keywords: 'tags',
  lang: 'language', 'language code': 'language',
};

const csvRowSchema = z.object({
  title: z.string().trim().min(1, 'title is required'),
  authors: z.string().trim().optional(),
  year: z.string().trim().regex(/^\d{4}$/, 'year must be 4 digits').optional().or(z.literal('')),
  publisher: z.string().trim().optional(),
  doi: z.string().trim().optional(),
  isbn: z.string().trim().optional(),
  type: z.enum(WORK_TYPES).default('book').or(z.literal('').transform(() => 'book' as const)),
  language: z.string().trim().optional(),
  tags: z.string().trim().optional(),
});
export type CsvImportRow = z.infer<typeof csvRowSchema>;

export interface RowError {
  line: number;
  message: string;
}

/** import field -> index of the CSV column that feeds it, or -1 to ignore. */
export type ColumnMapping = Record<ImportField, number>;

export interface CsvTable {
  header: string[];
  body: string[][];
}

export function readCsvTable(text: string): CsvTable {
  const [header = [], ...body] = parseCsv(text);
  return { header, body };
}

export function autoMapping(header: string[]): ColumnMapping {
  const mapping = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, -1])) as ColumnMapping;
  header.forEach((h, index) => {
    const key = h.trim().toLowerCase();
    const field = (IMPORT_FIELDS as readonly string[]).includes(key) ? (key as ImportField) : HEADER_ALIASES[key];
    if (field && mapping[field] === -1) mapping[field] = index;
  });
  return mapping;
}

export function mapCsvRows(body: string[][], mapping: ColumnMapping): { rows: { line: number; data: CsvImportRow }[]; errors: RowError[] } {
  const rows: { line: number; data: CsvImportRow }[] = [];
  const errors: RowError[] = [];
  body.forEach((cells, i) => {
    const line = i + 2; // line 1 is the header
    const record = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, mapping[f] >= 0 ? (cells[mapping[f]] ?? '') : '']));
    const parsed = csvRowSchema.safeParse(record);
    if (!parsed.success) return errors.push({ line, message: parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') });
    for (const scheme of ['doi', 'isbn'] as const) {
      const value = parsed.data[scheme];
      if (value && !parseIdentifier(scheme, value).ok) return errors.push({ line, message: `${scheme.toUpperCase()} "${value}" is not valid.` });
    }
    rows.push({ line, data: parsed.data });
  });
  return { rows, errors };
}

// One-shot form: header names pick the columns. Used by the tests and as the default guess.
export function parseCsvImport(text: string): { rows: { line: number; data: CsvImportRow }[]; errors: RowError[] } {
  const { header, body } = readCsvTable(text);
  if (!header.length) return { rows: [], errors: [{ line: 1, message: 'The file is empty.' }] };
  const mapping = autoMapping(header);
  if (mapping.title === -1) return { rows: [], errors: [{ line: 1, message: 'The header row needs a "title" column.' }] };
  return mapCsvRows(body, mapping);
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
