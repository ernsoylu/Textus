import { describe, expect, it } from 'vitest';
import { filterNotes, groupNotes, type NoteFilters } from './noteFilters';
import type { AnnotationItem } from '@/hooks/useAnnotations';

const note = (id: string, over: Partial<AnnotationItem> = {}): AnnotationItem => ({
  id, record_id: 'r1', asset_id: 'a1', anchor_type: 'pdf_page', anchor_data: { page: 1 }, highlighted_text: null, note: null, color: 'yellow',
  created_at: '2026-09-01T00:00:00Z', records: { title: 'Style Guide', work_id: 'w1', works: null }, annotation_tags: [], ...over,
});
const all: NoteFilters = { q: '', tagId: '', color: '', commentsOnly: false, sort: 'newest' };
const tags = new Map([['t1', 'Grammar']]);

describe('filterNotes', () => {
  const items = [
    note('a', { highlighted_text: 'Çelik köprü', note: 'bridge', color: 'green' }),
    note('b', { highlighted_text: 'Harding, 1985', annotation_tags: [{ tag_id: 't1' }] }),
    note('c', { note: '  ', records: { title: 'Greek History', work_id: 'w2', works: null }, record_id: 'r2' }),
  ];
  const ids = (f: Partial<NoteFilters>) => filterNotes(items, { ...all, ...f }, tags).map((n) => n.id);

  it('matches every word across quote, comment, book title and tag names, ignoring case and accents', () => {
    expect(ids({ q: 'celik BRIDGE' })).toEqual(['a']);
    expect(ids({ q: '1985 grammar' })).toEqual(['b']);
    expect(ids({ q: 'greek' })).toEqual(['c']);
    expect(ids({ q: 'celik greek' })).toEqual([]);
  });

  it('filters by tag, color and comments', () => {
    expect(ids({ tagId: 't1' })).toEqual(['b']);
    expect(ids({ color: 'green' })).toEqual(['a']);
    expect(ids({ color: 'yellow' })).toEqual(['b', 'c']);
    expect(ids({ commentsOnly: true })).toEqual(['a']);
  });
});

describe('groupNotes', () => {
  const items = [
    note('p9', { anchor_data: { page: 9 }, created_at: '2026-09-03T00:00:00Z' }),
    note('x', { record_id: 'r2', records: { title: 'Anabasis', work_id: 'w2', works: null }, created_at: '2026-09-02T00:00:00Z' }),
    note('p2', { anchor_data: { page: 2 }, created_at: '2026-09-01T00:00:00Z' }),
  ];

  it('groups by book, newest first by default', () => {
    expect(groupNotes(items, 'newest').map((g) => [g.title, g.items.map((n) => n.id)])).toEqual([['Style Guide', ['p9', 'p2']], ['Anabasis', ['x']]]);
  });

  it('orders pages within books and books A–Z in page order', () => {
    expect(groupNotes(items, 'page').map((g) => [g.title, g.items.map((n) => n.id)])).toEqual([['Anabasis', ['x']], ['Style Guide', ['p2', 'p9']]]);
  });
});
