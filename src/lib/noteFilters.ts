import { bookTitle, type AnnotationItem } from '@/hooks/useAnnotations';

// The Notes page's search, filters, sort and grouping, applied client-side to the user's own notes.
export const NOTE_SORTS = ['newest', 'oldest', 'page'] as const;
export type NoteSort = (typeof NOTE_SORTS)[number];

export interface NoteFilters {
  q: string;
  tagId: string;
  color: string;
  commentsOnly: boolean;
  sort: NoteSort;
}

export interface NoteGroup {
  recordId: string;
  workId: string | undefined;
  title: string;
  items: AnnotationItem[];
}

// Case- and accent-insensitive ("Çelik" matches "celik", "İstanbul" matches "istanbul").
const fold = (s: string) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

const pageOf = (a: AnnotationItem) => (a.anchor_type === 'pdf_page' ? ((a.anchor_data as { page?: number }).page ?? 0) : 0);
const time = (a: AnnotationItem) => (a.created_at ? Date.parse(a.created_at) : 0);

export function filterNotes(items: AnnotationItem[], f: NoteFilters, tagNames: Map<string, string>): AnnotationItem[] {
  const words = fold(f.q).split(/\s+/).filter(Boolean);
  return items.filter((a) => {
    if (f.tagId && !a.annotation_tags.some((t) => t.tag_id === f.tagId)) return false;
    if (f.color && (a.color ?? 'yellow') !== f.color) return false;
    if (f.commentsOnly && !a.note?.trim()) return false;
    if (!words.length) return true;
    const haystack = fold([a.highlighted_text, a.note, bookTitle(a), ...a.annotation_tags.map((t) => tagNames.get(t.tag_id))].filter(Boolean).join(' '));
    return words.every((w) => haystack.includes(w));
  });
}

/** Notes grouped by book. In page order books go A–Z and notes by page; otherwise both follow the notes' dates. */
export function groupNotes(items: AnnotationItem[], sort: NoteSort): NoteGroup[] {
  const order = (a: AnnotationItem, b: AnnotationItem) =>
    sort === 'oldest' ? time(a) - time(b) : sort === 'page' ? pageOf(a) - pageOf(b) || time(a) - time(b) : time(b) - time(a);
  const groups = new Map<string, NoteGroup>();
  for (const a of [...items].sort(order)) {
    const g = groups.get(a.record_id) ?? { recordId: a.record_id, workId: a.records?.work_id, title: bookTitle(a), items: [] };
    g.items.push(a);
    groups.set(a.record_id, g);
  }
  const list = [...groups.values()];
  return sort === 'page' ? list.sort((a, b) => a.title.localeCompare(b.title)) : list;
}
