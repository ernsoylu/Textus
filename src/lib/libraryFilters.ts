import { z } from 'zod';

// FR-ORG-3/5: the library filter + sort state. It is sent to library_page() (which does the filtering and
// sorting in SQL) and is also what a saved search stores, so it is validated with Zod on the way back out of the database.
export const SORTS = ['relevance', 'added', 'title', 'author', 'published', 'recent'] as const;

export const filtersSchema = z.object({
  q: z.string().default(''),
  workType: z.string().default(''),
  tagId: z.string().default(''),
  collectionId: z.string().default(''),
  status: z.string().default(''),
  format: z.string().default(''),
  language: z.string().default(''),
  sort: z.enum(SORTS).default('added'),
});

export type LibraryFilters = z.infer<typeof filtersSchema>;
export const EMPTY_FILTERS: LibraryFilters = filtersSchema.parse({});

export function parseFilters(raw: unknown): LibraryFilters {
  const parsed = filtersSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_FILTERS;
}
