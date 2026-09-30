import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLanguages, useLibrary } from '@/hooks/useLibrary';
import { useCoverUrls } from '@/hooks/useCoverUrls';
import { useDebounced } from '@/hooks/useDebounced';
import { useSavedSearches, useSaveSearch } from '@/hooks/useSavedSearches';
import { EMPTY_FILTERS, SORTS, type LibraryFilters } from '@/lib/libraryFilters';
import { BookSearchResults } from '@/components/library/BookSearchResults';
import { RecordCard } from '@/components/library/RecordCard';
import { LibraryFilterBar } from '@/components/library/LibraryFilterBar';
import { BulkBar } from '@/components/library/BulkBar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useMetadataJobs } from '@/hooks/useJobs';

export function Library() {
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saveName, setSaveName] = useState('');
  const [params] = useSearchParams();
  const saved = useSavedSearches();
  const saveSearch = useSaveSearch();
  const languages = useLanguages();

  // FR-ORG-5: /library?saved=<id> opens a saved search (virtual library); /library?q=… opens a search.
  const qParam = params.get('q');
  useEffect(() => {
    if (qParam !== null) setFilters((f) => ({ ...f, q: qParam }));
  }, [qParam]);
  const sortParam = params.get('sort');
  useEffect(() => {
    if (sortParam && SORTS.includes(sortParam as LibraryFilters['sort'])) setFilters((f) => ({ ...f, sort: sortParam as LibraryFilters['sort'] }));
  }, [sortParam]);
  const savedId = params.get('saved');
  const savedFilters = saved.data?.find((s) => s.id === savedId)?.filters;
  useEffect(() => {
    if (savedFilters) setFilters(savedFilters);
  }, [savedFilters]);

  // NFR-PERF-1: filtering, sorting and search run in Postgres (library_page), one page at a time. Typing waits
  // for a pause before it becomes a query.
  const debouncedQ = useDebounced(filters.q);
  const query = useLibrary({ ...filters, q: debouncedQ });
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const metadataJobs = useMetadataJobs(items.flatMap((item) => item.recordIds));
  const total = query.data?.pages[0]?.total ?? 0;
  const coverUrls = useCoverUrls(items.flatMap((w) => (w.coverPath ? [w.coverPath] : [])));
  const selected = items.filter((w) => selectedIds.has(w.workId));
  const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  // Load the next page when the sentinel below the grid scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && !isFetchingNextPage && void fetchNextPage(), { rootMargin: '400px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

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
    // overflow-anchor: none — otherwise the browser keeps the viewport pinned to the sentinel as pages arrive, and the
    // list would load itself all the way to the end.
    <div className="flex flex-col gap-6 [overflow-anchor:none]">
      <div className="flex items-center justify-between gap-4">
        <p className="text-heading text-fg">Library</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>{selecting ? 'Done selecting' : 'Select'}</Button>
          <Link to="/tags">
            <Button variant="secondary">Tags</Button>
          </Link>
          <Link to="/library/new">
            <Button>Add work</Button>
          </Link>
        </div>
      </div>

      <div className="relative w-full max-w-[520px]" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false); }} onKeyDown={(event) => {
        if (event.key === 'Escape') setSearchOpen(false);
        if (event.key === 'ArrowDown' && event.target instanceof HTMLInputElement) { event.preventDefault(); event.currentTarget.querySelector<HTMLAnchorElement>('ul a')?.focus(); }
      }}>
        <Input aria-label="Search library" placeholder="Search title, contributor or file text…" value={filters.q} onFocus={() => setSearchOpen(true)} onChange={(e) => { setFilters({ ...filters, q: e.target.value }); setSearchOpen(true); }} />
        {searchOpen && filters.q.trim() && <BookSearchResults items={items.slice(0, 8)} loading={query.isFetching || debouncedQ !== filters.q} error={query.error?.message} onSelect={() => setSearchOpen(false)} />}
      </div>
      <LibraryFilterBar filters={filters} languages={languages.data ?? []} onChange={setFilters} />

      {filtered && (
        <form onSubmit={handleSave} className="flex flex-wrap items-start gap-2">
          <Input placeholder="Save this view as…" value={saveName} onChange={(e) => setSaveName(e.target.value)} error={saveSearch.error?.message} className="w-auto min-w-[200px]" />
          <Button type="submit" variant="secondary" isLoading={saveSearch.isPending} disabled={!saveName.trim()}>Save search</Button>
          <Button type="button" variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Button>
        </form>
      )}

      {selecting && <BulkBar selected={selected} onDone={stopSelecting} />}

      {query.isLoading && <p className="text-body text-muted">Loading…</p>}
      {query.error && <p className="text-body text-red">Could not load your library: {query.error.message}</p>}
      {filtered && !query.isLoading && total === 0 && <p className="text-body text-muted">Nothing matches these filters.</p>}
      {!filtered && !query.isLoading && total === 0 && <p className="text-body text-muted">Nothing here yet. Add your first work to get started.</p>}
      {total > 0 && <p className="text-small text-muted">{total} {total === 1 ? 'work' : 'works'}</p>}

      <div className="flex flex-wrap gap-6">
        {items.map((item) => (
          <RecordCard
            key={item.workId}
            workId={item.workId}
            title={item.title}
            byline={item.byline}
            meta={item.meta}
            detail={item.detail}
            userRating={item.userRating}
            metadataMessage={item.recordIds.map((id) => metadataJobs.data?.[id]).find(Boolean)}
            coverUrl={item.coverPath ? coverUrls.data?.get(item.coverPath) : undefined}
            selected={selectedIds.has(item.workId)}
            onToggleSelect={selecting ? () => toggle(item.workId) : undefined}
          />
        ))}
      </div>
      <div ref={sentinel} aria-hidden="true" />
      {hasNextPage && <div><Button variant="secondary" isLoading={isFetchingNextPage} onClick={() => void fetchNextPage()}>Show more</Button></div>}
    </div>
  );
}
