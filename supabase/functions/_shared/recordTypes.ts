export const WORK_TYPES = ['book', 'article', 'chapter', 'serial', 'thesis', 'report', 'standard', 'other'] as const;
export type WorkType = (typeof WORK_TYPES)[number];
export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  book: 'Book', article: 'Article', chapter: 'Chapter', serial: 'Serial', thesis: 'Thesis', report: 'Report', standard: 'Standard', other: 'Other',
};
export const RECORD_TYPES = ['edition', 'article_version', 'chapter', 'issue', 'report', 'thesis', 'standard', 'other'] as const;
export const RECORD_TYPE_LABELS: Record<(typeof RECORD_TYPES)[number], string> = {
  edition: 'Book edition', article_version: 'Article version', chapter: 'Chapter', issue: 'Serial issue', report: 'Report', thesis: 'Thesis', standard: 'Standard', other: 'Other',
};

export function defaultIdentifierScheme(recordType: string) {
  return recordType === 'standard' ? 'iso' : recordType === 'issue' ? 'issn' : ['article_version', 'thesis', 'report'].includes(recordType) ? 'doi' : 'isbn';
}

// The first record's type follows the work type (§6.1); a serial starts with no record,
// its issues are added later (FR-SER-1).
export const FIRST_RECORD_TYPE: Record<WorkType, string | null> = {
  book: 'edition', article: 'article_version', chapter: 'chapter', serial: null, thesis: 'thesis', report: 'report', standard: 'standard', other: 'other',
};
