import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookActivity } from '@/components/activity/BookActivity';
import { PassageSearch } from '@/components/activity/PassageSearch';
import { SourceSearch } from '@/components/account/SourceSearch';
import { Button } from '@/components/ui/button';
import { useActivity } from '@/hooks/useActivity';
import { activityView, type ActivityGroup, type ActivityRow } from '@/lib/activityStage';
import { supabase } from '@/lib/supabase';

const GROUPS: { id: ActivityGroup; title: string; open: boolean }[] = [
  { id: 'attention', title: 'Needs attention', open: true },
  { id: 'progress', title: 'In progress', open: true },
  { id: 'waiting', title: 'Waiting', open: false },
  { id: 'done', title: 'Done', open: false },
];

// Figma "activity": each book's way through reading, metadata, full-text indexing and AI search, with
// what is happening now, how far it is, and what to do when something fails.
export function Activity() {
  const client = useQueryClient();
  const activity = useActivity();
  const control = useMutation({ mutationFn: async ({ action, asset }: { action: 'retry' | 'cancel' | 'reindex' | 'backfill'; asset?: string }) => {
    const { error } = await supabase.rpc('control_passage_index', { p_action: action, ...(asset ? { p_asset: asset } : {}) });
    if (error) throw error;
    await Promise.all([client.invalidateQueries({ queryKey: ['activity'] }), client.invalidateQueries({ queryKey: ['jobs'] })]);
  } });
  const rows = (activity.data ?? []).map((row: ActivityRow) => ({ row, view: activityView(row) }));
  const done = rows.filter(({ view }) => view.group === 'done').length;
  const overall = rows.length ? Math.round(rows.reduce((sum, { view }) => sum + view.progress, 0) / rows.length) : 0;
  const unindexed = rows.some(({ row }) => ['pdf', 'epub'].includes(row.file_format) && !row.passage_index);

  return (
    <div className="flex max-w-[760px] flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-small text-green">ACTIVITY</p>
        <p className="font-serif text-title text-fg">Quietly at work.</p>
        <p className="text-body text-muted">Each book is read, catalogued, indexed for full-text search and prepared for AI search in the background.</p>
      </div>
      {activity.isLoading && <p className="text-body text-muted">Loading…</p>}
      {(activity.error || control.error) && <p role="alert" className="text-body text-red">Could not load or update activity.</p>}
      {activity.isSuccess && !rows.length && <p className="text-body text-muted">Nothing to process yet. Add a book and its progress shows up here.</p>}
      {rows.length > 0 && (
        <div className="flex flex-col gap-2 rounded-8 border border-border bg-dim p-4">
          <p className="text-body text-fg">{done} of {rows.length} books fully processed · {overall}% overall</p>
          <div role="progressbar" aria-label="Library progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={overall} className="h-2 overflow-hidden rounded-full bg-raised">
            <div className="h-full bg-green" style={{ width: `${overall}%` }} />
          </div>
          {unindexed && <Button variant="secondary" disabled={control.isPending} onClick={() => control.mutate({ action: 'backfill' })}>Index files that were never indexed (up to 100)</Button>}
        </div>
      )}
      {GROUPS.map((group) => {
        const members = rows.filter(({ view }) => view.group === group.id);
        return members.length > 0 && (
          <details key={group.id} open={group.open} className="flex flex-col gap-2">
            <summary className="cursor-pointer text-heading text-fg">{group.title} <span className="text-muted">({members.length})</span></summary>
            <ul className="mt-2 flex flex-col gap-2">
              {members.map(({ row }) => <BookActivity key={row.asset_id} row={row} busy={control.isPending} onControl={(action, asset) => control.mutate({ action, asset })} />)}
            </ul>
          </details>
        );
      })}
      <section className="flex flex-col gap-3 border-t border-border pt-5">
        <h2 className="text-heading text-fg">Search the text of your library</h2>
        <PassageSearch />
        <SourceSearch />
      </section>
    </div>
  );
}
