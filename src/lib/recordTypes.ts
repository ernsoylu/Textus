export const WORK_TYPES = ['book', 'article', 'chapter', 'serial', 'thesis', 'report', 'other'] as const;
export type WorkType = (typeof WORK_TYPES)[number];

// The first record's type follows the work type (§6.1); a serial starts with no record,
// its issues are added later (FR-SER-1).
export const FIRST_RECORD_TYPE: Record<WorkType, string | null> = {
  book: 'edition', article: 'article_version', chapter: 'chapter', serial: null, thesis: 'thesis', report: 'report', other: 'other',
};
