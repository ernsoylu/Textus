import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useWorks } from '@/hooks/useWorks';
import { useSearch } from '@/hooks/useSearch';
import { useSavedSearches, useSaveSearch } from '@/hooks/useSavedSearches';
import { applyFilters, EMPTY_FILTERS, type LibraryFilters } from '@/lib/libraryFilters';
import { RecordCard } from '@/components/library/RecordCard';
import { LibraryFilterBar } from '@/components/library/LibraryFilterBar';
import { BulkBar } from '@/components/library/BulkBar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function Library() {
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saveName, setSaveName] = useState('');
  const [params] = useSearchParams();
  const { data, isLoading, error } = useWorks();
  const search = useSearch(filters.q);
  const saved = useSavedSearches();
  const saveSearch = useSaveSearch();

  // FR-ORG-5: /library?saved=<id> opens a saved search (virtual library).
  const savedId = params.get('saved');
  const savedFilters = saved.data?.find((s) => s.id === savedId)?.filters;
  useEffect(() => {
    if (savedFilters) setFilters(savedFilters);
  }, [savedFilters]);

  // FR-SRCH-1: search_library() returns matching work_ids ranked by relevance; the rest of the
  // facets are filtered client-side over the already-loaded list (FR-ORG-3).
  const rank = useMemo(() => (search.data ? new Map(search.data.map((r) => [r.work_id, r.rank])) : undefined), [search.data]);
  const visible = useMemo(() => (data ? applyFilters(data, filters, rank) : undefined), [data, filters, rank]);
  const languages = useMemo(() => [...new Set((data ?? []).flatMap((w) => (w.language ? [w.language] : [])))].sort(), [data]);
  const selected = (data ?? []).filter((w) => selectedIds.has(w.workId));
  const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  function toggle(workId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(workId)) next.add(workId);
      return next;
    });
  }
  function stopSelecting() {
    setSelecting(false);
    setSelectedIds(new Set());
  }
  function handleSave(e: FormEvent) {
    e.preventDefault();
    if (saveName.trim()) saveSearch.mutate({ name: saveName, filters }, { onSuccess: () => setSaveName('') });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-heading text-fg">Library</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>{selecting ? 'Done selecting' : 'Select'}</Button>
          <Link to="/library/new">
            <Button>Add work</Button>
          </Link>
        </div>
      </div>

      <Input placeholder="Search title or contributor…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} className="max-w-[424px]" />
      <LibraryFilterBar filters={filters} languages={languages} onChange={setFilters} />

      {filtered && (
        <form onSubmit={handleSave} className="flex flex-wrap items-start gap-2">
          <Input placeholder="Save this view as…" value={saveName} onChange={(e) => setSaveName(e.target.value)} error={saveSearch.error?.message} className="w-auto min-w-[200px]" />
          <Button type="submit" variant="secondary" isLoading={saveSearch.isPending} disabled={!saveName.trim()}>Save search</Button>
          <Button type="button" variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Button>
        </form>
      )}

      {selecting && <BulkBar selected={selected} onDone={stopSelecting} />}

      {isLoading && <p className="text-body text-muted">Loading…</p>}
      {error && <p className="text-body text-red">Could not load your library: {error.message}</p>}
      {search.error && <p className="text-body text-red">Search failed: {search.error.message}</p>}
      {filtered && visible && visible.length === 0 && <p className="text-body text-muted">Nothing matches these filters.</p>}
      {!filtered && data && data.length === 0 && <p className="text-body text-muted">Nothing here yet. Add your first work to get started.</p>}

      <div className="flex flex-wrap gap-6">
        {visible?.map((item) => (
          <RecordCard
            key={item.workId}
            workId={item.workId}
            title={item.title}
            byline={item.byline}
            meta={item.meta}
            selected={selectedIds.has(item.workId)}
            onToggleSelect={selecting ? () => toggle(item.workId) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
