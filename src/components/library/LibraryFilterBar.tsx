import { SORTS, type LibraryFilters } from '@/lib/libraryFilters';
import { useTags } from '@/hooks/useTags';
import { useCollections } from '@/hooks/useCollections';
import { WORK_TYPES, WORK_TYPE_LABELS } from '@/lib/recordTypes';

const SORT_LABELS: Record<(typeof SORTS)[number], string> = {
  relevance: 'Relevance / newest', added: 'Date added', title: 'Title', author: 'Author', published: 'Date published', recent: 'Recently read',
};
const STATUSES = ['unread', 'reading', 'finished', 'abandoned'];
const FORMATS = ['pdf', 'epub'];
const SELECT = 'rounded-8 border border-muted bg-dim p-3 text-body text-fg';

// FR-ORG-3: filter by work type, tag, collection, reading status, file format, language; sort.
export function LibraryFilterBar({ filters, languages, onChange }: Readonly<{ filters: LibraryFilters; languages: string[]; onChange: (next: LibraryFilters) => void }>) {
  const tags = useTags();
  const collections = useCollections();
  const pick = (key: keyof LibraryFilters, label: string, options: { value: string; label: string }[]) => (
    <select aria-label={label} className={SELECT} value={filters[key]} onChange={(e) => onChange({ ...filters, [key]: e.target.value })}>
      <option value="">{label}: any</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  const plain = (values: string[]) => values.map((v) => ({ value: v, label: v }));
  return (
    <div className="flex flex-wrap gap-2">
      {pick('workType', 'Type', WORK_TYPES.map((value) => ({ value, label: WORK_TYPE_LABELS[value] })))}
      {pick('tagId', 'Tag', (tags.data ?? []).map((t) => ({ value: t.id, label: t.name })))}
      {pick('collectionId', 'Collection', (collections.data ?? []).map((c) => ({ value: c.id, label: c.name })))}
      {pick('status', 'Status', plain(STATUSES))}
      {pick('format', 'Format', plain(FORMATS))}
      {pick('language', 'Language', plain(languages))}
      <select aria-label="Sort" className={SELECT} value={filters.sort} onChange={(e) => onChange({ ...filters, sort: e.target.value as LibraryFilters['sort'] })}>
        {SORTS.map((s) => <option key={s} value={s}>Sort: {SORT_LABELS[s]}</option>)}
      </select>
    </div>
  );
}
