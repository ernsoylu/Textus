import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWorks } from '@/hooks/useWorks';
import { useSearch } from '@/hooks/useSearch';
import { RecordCard } from '@/components/library/RecordCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function Library() {
  const [query, setQuery] = useState('');
  const { data, isLoading, error } = useWorks();
  const search = useSearch(query);

  // FR-SRCH-1: search_library() returns matching work_ids ranked by relevance; the byline/meta
  // for display already lives in the useWorks() list, so results are that list filtered and
  // reordered to match — no second query needed for what's already in hand.
  const visible = useMemo(() => {
    if (!query.trim() || !search.data) return data;
    const rankByWork = new Map(search.data.map((r) => [r.work_id, r.rank]));
    return (data ?? []).filter((item) => rankByWork.has(item.workId)).sort((a, b) => (rankByWork.get(b.workId) ?? 0) - (rankByWork.get(a.workId) ?? 0));
  }, [query, search.data, data]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-heading text-fg">Library</p>
        <Link to="/library/new">
          <Button>Add work</Button>
        </Link>
      </div>

      <Input placeholder="Search title or contributor…" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-[424px]" />

      {isLoading && <p className="text-body text-muted">Loading…</p>}
      {error && <p className="text-body text-red">Could not load your library: {error.message}</p>}
      {search.error && <p className="text-body text-red">Search failed: {search.error.message}</p>}
      {query.trim() && visible && visible.length === 0 && <p className="text-body text-muted">No matches for "{query}".</p>}
      {!query.trim() && data && data.length === 0 && <p className="text-body text-muted">Nothing here yet. Add your first work to get started.</p>}

      <div className="flex flex-wrap gap-6">
        {visible?.map((item) => <RecordCard key={item.workId} {...item} />)}
      </div>
    </div>
  );
}
