import { z } from 'zod';

// FR-ORG-3/5: the library filter + sort state. This same shape is what a saved search stores,
// so it is validated with Zod on the way back out of the database.
export const SORTS = ['relevance', 'added', 'title', 'author', 'published', 'recent'] as const;

export const filtersSchema = z.object({
  q: z.string().default(''),
  workType: z.string().default(''),
  tagId: z.string().default(''),
  collectionId: z.string().default(''),
  status: z.string().default(''),
  format: z.string().default(''),
  language: z.string().default(''),
  sort: z.enum(SORTS).default('relevance'),
});

export type LibraryFilters = z.infer<typeof filtersSchema>;
export const EMPTY_FILTERS: LibraryFilters = filtersSchema.parse({});

export function parseFilters(raw: unknown): LibraryFilters {
  const parsed = filtersSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_FILTERS;
}

export interface FilterableWork {
  workId: string;
  title: string;
  byline: string;
  workType: string;
  language: string | null;
  addedAt: string;
  publishedAt: string | null;
  tagIds: string[];
  collectionIds: string[];
  formats: string[];
  statuses: string[]; // reading statuses across the work's records; ['unread'] when none recorded
  lastReadAt: string | null;
}

// Newest first; missing values sort last.
function desc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
}

// Attributed works first, alphabetically by byline.
function byAuthor(a: FilterableWork, b: FilterableWork): number {
  if (a.byline && b.byline) return a.byline.localeCompare(b.byline);
  if (a.byline) return -1;
  if (b.byline) return 1;
  return 0;
}

// `rank` is the search_library() result for `f.q`; undefined while it loads (no filtering yet).
// ponytail: filters run client-side over the whole library, move them into SQL if it outgrows a few thousand works.
export function applyFilters<T extends FilterableWork>(items: T[], f: LibraryFilters, rank?: Map<string, number>): T[] {
  const searching = f.q.trim().length > 0 && rank !== undefined;
  const kept = items.filter(
    (w) =>
      (!searching || rank!.has(w.workId)) &&
      (!f.workType || w.workType === f.workType) &&
      (!f.tagId || w.tagIds.includes(f.tagId)) &&
      (!f.collectionId || w.collectionIds.includes(f.collectionId)) &&
      (!f.status || w.statuses.includes(f.status)) &&
      (!f.format || w.formats.includes(f.format)) &&
      (!f.language || w.language === f.language),
  );
  const byAdded = (a: T, b: T) => desc(a.addedAt, b.addedAt);
  const compare: (a: T, b: T) => number = {
    relevance: searching ? (a: T, b: T) => (rank!.get(b.workId) ?? 0) - (rank!.get(a.workId) ?? 0) : byAdded,
    added: byAdded,
    title: (a: T, b: T) => a.title.localeCompare(b.title),
    author: byAuthor,
    published: (a: T, b: T) => desc(a.publishedAt, b.publishedAt),
    recent: (a: T, b: T) => desc(a.lastReadAt, b.lastReadAt),
  }[f.sort];
  return kept.sort((a, b) => compare(a, b) || byAdded(a, b));
}
