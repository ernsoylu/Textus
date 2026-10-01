import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useContributors, useDuplicatePairs, useMergeContributors, useNotSamePerson, useConfirmContributor, type ContributorListItem } from '@/hooks/useContributors';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const link = (c: ContributorListItem) => (
  <Link to={`/contributors/${c.id}`} className="text-body text-fg underline">
    {c.display_name} <span className="text-small text-muted">({c.credits} credits)</span>
  </Link>
);

// FR-CONTRIB-7/8: contributor list, provisional review queue, and duplicate finder.
export function Contributors() {
  const [filter, setFilter] = useState('');
  const { data, isLoading, error } = useContributors();
  const pairs = useDuplicatePairs();
  const merge = useMergeContributors();
  const notSame = useNotSamePerson();
  const confirm = useConfirmContributor();
  const provisional = data?.filter((c) => c.status === 'provisional') ?? [];
  const shown = data?.filter((c) => c.display_name.toLowerCase().includes(filter.trim().toLowerCase()));
  const actionError = merge.error ?? notSame.error ?? confirm.error;

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-1"><h1 className="font-serif text-title text-fg">Contributors</h1><p className="text-body text-muted">Explore authors and their books, and review imported identities.</p></div>
      {isLoading && <p className="text-body text-muted">Loading…</p>}
      {error && <p className="text-body text-red">Could not load contributors: {error.message}</p>}
      {actionError && <p className="text-small text-red">{actionError.message}</p>}

      {provisional.length > 0 && (
        <section className="flex flex-col gap-2 rounded-8 border border-border p-4">
          <p className="text-label text-fg">Review queue · {provisional.length}</p>
          <p className="text-small text-muted">Imported names that matched an existing contributor only loosely.</p>
          {provisional.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
              {link(c)}
              <Button variant="secondary" onClick={() => confirm.mutate(c.id)}>Confirm</Button>
            </div>
          ))}
        </section>
      )}

      {pairs.data && pairs.data.length > 0 && (
        <section className="flex flex-col gap-3 rounded-8 border border-border p-4">
          <p className="text-label text-fg">Possible duplicates · {pairs.data.length}</p>
          {pairs.data.map(({ a, b }) => (
            <div key={`${a.id}:${b.id}`} className="flex flex-col gap-1">
              <div className="flex flex-wrap gap-4">{link(a)}{link(b)}</div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => merge.mutate({ keep: a.id, merge: b.id })}>Merge into "{a.display_name}"</Button>
                <Button variant="secondary" onClick={() => merge.mutate({ keep: b.id, merge: a.id })}>Merge into "{b.display_name}"</Button>
                <Button variant="ghost" onClick={() => notSame.mutate({ a: a.id, b: b.id })}>Not the same person</Button>
              </div>
            </div>
          ))}
        </section>
      )}

      <Input aria-label="Filter contributors" placeholder="Filter contributors…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {shown?.length === 0 && <p role="status" className="text-body text-muted">{filter.trim() ? 'No contributors match your search.' : 'No contributors yet.'}</p>}
      <ul className="flex flex-col gap-1">
        {shown?.map((c) => (
          <li key={c.id}>{link(c)}{c.status === 'provisional' && <span className="text-small text-yellow"> · provisional</span>}</li>
        ))}
      </ul>
    </div>
  );
}
