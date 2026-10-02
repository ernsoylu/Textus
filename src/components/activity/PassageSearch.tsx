import { readerLink } from '../../../supabase/functions/_shared/sourceLinks';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import type { Database } from '@/types/database';
type Hit = Database['public']['Functions']['search_passages']['Returns'][number];

// Full-text search over indexed passages, without AI.
export function PassageSearch() {
  const [query, setQuery] = useState('');
  const search = useMutation({ mutationFn: async (): Promise<Hit[]> => {
    const { data, error } = await supabase.rpc('search_passages', { p_query: query, p_limit: 20 });
    if (error) throw error;
    return data;
  } });
  return <div className="flex flex-col gap-3">
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search.mutate(); }}>
      <input aria-label="Search indexed passages" maxLength={1000} value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 rounded-8 border border-border bg-dim p-2" />
      <Button disabled={!query.trim() || search.isPending}>Search</Button>
    </form>
    {search.error && <p role="alert">Could not search indexed passages.</p>}
    {search.isSuccess && !search.data.length && <p role="status">No supporting passage found in indexed text.</p>}
    <ul className="flex flex-col gap-3">{search.data?.map((hit) => <li key={hit.id}>
      <Link className="text-green underline" to={readerLink(hit.work_id, hit.record_id, hit.asset_id, hit.page, hit.cfi)}>{hit.title} · {hit.page_label ?? hit.page ?? `section ${hit.section + 1}`}</Link>
      <p className="text-small text-muted">{hit.content}</p>
    </li>)}</ul>
  </div>;
}
