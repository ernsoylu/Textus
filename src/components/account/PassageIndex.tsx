import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import type { Database } from '@/types/database';
type Hit = Database['public']['Functions']['search_passages']['Returns'][number];
export function PassageIndex() {
  const client = useQueryClient();
  const [query, setQuery] = useState('');
  const coverage = useQuery({ queryKey: ['passages', 'coverage'], refetchInterval: 10_000, queryFn: async () => {
    const { data, error } = await supabase.rpc('passage_coverage');
    if (error) throw error;
    return data as { indexedAssets: number; eligibleAssets: number; partial: boolean };
  } });
  const assets = useQuery({ queryKey: ['passages', 'assets'], refetchInterval: 10_000, queryFn: async () => {
    const { data, error } = await supabase.from('assets').select('id,metadata').in('file_format', ['pdf', 'epub']).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data.map((a) => ({ id: a.id, ...(a.metadata as { filename?: string; passage_index?: { status: string; done: number; total: number; passages: number; reason?: string } }) }));
  } });
  const control = useMutation({ mutationFn: async ({ action, asset }: { action: string; asset?: string }) => {
    const { error } = await supabase.rpc('control_passage_index', { p_action: action, ...(asset ? { p_asset: asset } : {}) });
    if (error) throw error;
    await Promise.all([client.invalidateQueries({ queryKey: ['passages'] }), client.invalidateQueries({ queryKey: ['jobs'] })]);
  } });
  const search = useMutation({ mutationFn: async (): Promise<Hit[]> => {
    const { data, error } = await supabase.rpc('search_passages', { p_query: query, p_limit: 20 });
    if (error) throw error;
    return data;
  } });
  return <div className="flex flex-col gap-3">
    <p className="text-body text-fg">Searchable passages</p>
    <p role="status" className="text-small text-muted">{coverage.data ? `${coverage.data.indexedAssets} of ${coverage.data.eligibleAssets} PDF/EPUB files fully indexed.${coverage.data.partial ? ' Coverage is partial.' : ''}` : 'Checking index coverage…'} Full-text search works without AI.</p>
    <Button disabled={control.isPending} onClick={() => control.mutate({ action: 'backfill' })}>Index unprocessed files (up to 100)</Button>
    {(coverage.error || assets.error || control.error) && <p role="alert">Could not load or update the passage index.</p>}
    <ul className="flex flex-col gap-2">
      {assets.data?.map((asset) => <li key={asset.id} className="rounded-8 border border-border p-3">
        <p className="text-small text-fg">{asset.filename ?? 'Uploaded file'} · {asset.passage_index?.status ?? 'pending'}</p>
        {asset.passage_index && <p className="text-small text-muted">{asset.passage_index.done}/{asset.passage_index.total} pages or sections · {asset.passage_index.passages} passages{asset.passage_index.reason ? ` · ${asset.passage_index.reason}` : ''}</p>}
        <div className="mt-2 flex gap-2">
          {['failed', 'cancelled'].includes(asset.passage_index?.status ?? '') && <Button variant="ghost" disabled={control.isPending} onClick={() => control.mutate({ action: 'retry', asset: asset.id })}>Retry</Button>}
          {['queued', 'indexing'].includes(asset.passage_index?.status ?? '') ? <Button variant="ghost" disabled={control.isPending} onClick={() => control.mutate({ action: 'cancel', asset: asset.id })}>Cancel</Button>
            : <Button variant="ghost" disabled={control.isPending} onClick={() => control.mutate({ action: 'reindex', asset: asset.id })}>Reindex</Button>}
        </div>
      </li>)}
    </ul>
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); search.mutate(); }}>
      <input aria-label="Search indexed passages" maxLength={1000} value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 rounded-8 border border-border bg-dim p-2" />
      <Button disabled={!query.trim() || search.isPending}>Search</Button>
    </form>
    {search.error && <p role="alert">Could not search indexed passages.</p>}
    {search.isSuccess && !search.data.length && <p role="status">No supporting passage found in indexed text.</p>}
    <ul className="flex flex-col gap-3">{search.data?.map((hit) => <li key={hit.id}>
      <Link className="text-green underline" to={`/library/${hit.work_id}/records/${hit.record_id}/assets/${hit.asset_id}/read?${hit.page ? `page=${hit.page}` : `cfi=${encodeURIComponent(hit.cfi ?? '')}`}`}>{hit.title} · {hit.page_label ?? hit.page ?? `section ${hit.section + 1}`}</Link>
      <p className="text-small text-muted">{hit.content}</p>
    </li>)}</ul>
  </div>;
}
