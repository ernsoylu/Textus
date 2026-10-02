import { useState } from 'react';
import { useWorkHistory, type HistoryActor } from '@/hooks/useWorkHistory';
import { actorLabel, fieldLabel, formatValue } from '@/lib/history';
import { Button } from '@/components/ui/button';

const FILTERS: [HistoryActor, string][] = [['all', 'All'], ['user', 'You'], ['agent', 'Agents'], ['ai', 'AI'], ['textus', 'Textus']];
const ACTOR_COLOR: Record<string, string> = { user: 'text-green', agent: 'text-yellow', ai: 'text-fg', textus: 'text-muted' };
type Change = { old?: unknown; new?: unknown };

// Everything that happened to this book — by you, agents, the local AI and Textus — with the values it replaced.
export function WorkHistory({ workId }: Readonly<{ workId: string }>) {
  const [actor, setActor] = useState<HistoryActor>('all');
  const history = useWorkHistory(workId, actor);
  const events = history.data?.pages.flat() ?? [];
  return (
    <section aria-labelledby="work-history" className="flex flex-col gap-3 rounded-8 border border-border p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="work-history" className="text-heading text-fg">History</h2>
        <div role="group" aria-label="Show changes by" className="flex flex-wrap gap-1">
          {FILTERS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={actor === value} onClick={() => setActor(value)}
              className={`rounded-8 px-3 py-1 text-small ${actor === value ? 'bg-green text-dim' : 'bg-raised text-fg'}`}>{label}</button>
          ))}
        </div>
      </div>
      {history.isLoading && <p className="text-small text-muted">Loading history…</p>}
      {history.error && <p role="alert" className="text-small text-red">Could not load this book’s history.</p>}
      {history.isSuccess && !events.length && <p className="text-small text-muted">{actor === 'all' ? 'No changes recorded yet.' : 'No changes from this source.'}</p>}
      <ol className="flex flex-col">
        {events.map((event) => {
          const changes = event.changes && typeof event.changes === 'object' && !Array.isArray(event.changes) ? Object.entries(event.changes as Record<string, Change>) : [];
          return (
            <li key={event.id} className="flex flex-col gap-1 border-t border-border py-3 first:border-t-0">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <time dateTime={event.created_at} className="text-small text-muted">{new Date(event.created_at).toLocaleString()}</time>
                <span className={`text-small ${ACTOR_COLOR[event.actor] ?? 'text-muted'}`}>{actorLabel(event.actor, event.actor_detail)}</span>
              </div>
              <p className="break-words text-body text-fg">{event.summary}</p>
              {changes.length > 0 && (
                <details className="text-small">
                  <summary className="cursor-pointer text-muted">Details</summary>
                  <dl className="mt-2 flex flex-col gap-2">
                    {changes.map(([field, change]) => (
                      <div key={field}>
                        <dt className="text-muted">{fieldLabel(field)}</dt>
                        <dd className="break-words text-fg">
                          {'old' in change && <span className="text-muted line-through">{formatValue(change.old)}</span>}
                          {'old' in change && 'new' in change && ' → '}
                          {'new' in change && <span>{formatValue(change.new)}</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </li>
          );
        })}
      </ol>
      {history.hasNextPage && <Button variant="ghost" disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>Show older changes</Button>}
    </section>
  );
}
