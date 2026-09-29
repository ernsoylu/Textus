import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useContributor, useContributors, useMergeContributors, useSplitCredits, useConfirmContributor } from '@/hooks/useContributors';
import { authorityUrl } from '@/lib/authorityLinks';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const SELECT = 'rounded-8 border border-muted bg-dim p-3 text-body text-fg';

// FR-CONTRIB-9 contributor page, with FR-CONTRIB-7 merge and split.
export function ContributorDetail() {
  const { contributorId } = useParams<{ contributorId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useContributor(contributorId);
  const all = useContributors();
  const merge = useMergeContributors();
  const split = useSplitCredits();
  const confirm = useConfirmContributor();
  const [mergeId, setMergeId] = useState('');
  const [splitTo, setSplitTo] = useState('');
  const [newName, setNewName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  if (isLoading) return <p className="text-body text-muted">Loading…</p>;
  if (error) return <p className="text-body text-red">Could not load this contributor: {error.message}</p>;
  if (!data) return null;

  const others = (all.data ?? []).filter((c) => c.id !== data.id);
  const byRole = new Map<string, typeof data.record_contributors>();
  for (const c of [...data.record_contributors].sort((x, y) => x.position - y.position)) byRole.set(c.role, [...(byRole.get(c.role) ?? []), c]);
  const conflict = merge.error?.message.includes('conflicting');
  const togglePick = (recordId: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(recordId)) next.add(recordId);
      return next;
    });
  const canSplit = picked.size > 0 && (splitTo || newName.trim());

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-heading text-fg">{data.display_name}</p>
        <p className="text-small text-muted">
          {data.kind}
          {data.birth_year ? ` · ${data.birth_year}–${data.death_year ?? ''}` : ''}
          {data.status === 'provisional' && ' · provisional'}
        </p>
        {data.status === 'provisional' && <div><Button variant="secondary" onClick={() => confirm.mutate(data.id)}>Confirm this contributor</Button></div>}
      </div>

      {data.contributor_names.length > 0 && (
        <section className="flex flex-col gap-1">
          <p className="text-label text-fg">Names</p>
          {data.contributor_names.map((n) => <p key={n.name} className="text-body text-fg">{n.name} <span className="text-small text-muted">{n.name_type}</span></p>)}
        </section>
      )}

      {data.contributor_identifiers.length > 0 && (
        <section className="flex flex-col gap-1">
          <p className="text-label text-fg">Identifiers</p>
          {data.contributor_identifiers.map((i) => {
            const url = authorityUrl(i.scheme, i.value);
            return (
              <p key={`${i.scheme}:${i.value}`} className="text-small text-green">
                {i.scheme.toUpperCase()}: {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="underline">{i.value}</a> : i.value}
              </p>
            );
          })}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <p className="text-label text-fg">Credits</p>
        {[...byRole].map(([role, credits]) => (
          <div key={role} className="flex flex-col gap-1">
            <p className="text-small text-muted">{role}</p>
            {credits.map((c) => (
              <label key={`${c.record_id}:${c.role}`} className="flex items-center gap-2 text-body text-fg">
                <input type="checkbox" checked={picked.has(c.record_id)} onChange={() => togglePick(c.record_id)} aria-label={`Select ${c.records?.title ?? 'record'} for split`} />
                <Link to={`/library/${c.records?.work_id}`} className="underline">{c.records?.title || c.records?.works?.title || 'Untitled'}</Link>
                {c.credited_as && <span className="text-small text-muted">as "{c.credited_as}"</span>}
              </label>
            ))}
          </div>
        ))}
        {data.record_contributors.length === 0 && <p className="text-small text-muted">No credits.</p>}
      </section>

      {data.record_contributors.length > 0 && (
        <section className="flex flex-col gap-2 rounded-8 border border-border p-4">
          <p className="text-label text-fg">Split: move {picked.size} selected credit(s) to</p>
          <div className="flex flex-wrap items-start gap-2">
            <select aria-label="Existing contributor" className={SELECT} value={splitTo} onChange={(e) => { setSplitTo(e.target.value); setNewName(''); }}>
              <option value="">Existing contributor…</option>
              {others.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </select>
            <Input placeholder="…or a new name" value={newName} onChange={(e) => { setNewName(e.target.value); setSplitTo(''); }} className="w-auto min-w-[180px]" />
            <Button
              variant="secondary"
              disabled={!canSplit}
              isLoading={split.isPending}
              onClick={() => split.mutate({ from: data.id, recordIds: [...picked], to: splitTo || undefined, newName }, { onSuccess: () => { setPicked(new Set()); setNewName(''); setSplitTo(''); } })}
            >
              Move credits
            </Button>
          </div>
          {split.error && <p className="text-small text-red">{split.error.message}</p>}
        </section>
      )}

      <section className="flex flex-col gap-2 rounded-8 border border-border p-4">
        <p className="text-label text-fg">Merge another contributor into this one</p>
        <div className="flex flex-wrap items-start gap-2">
          <select aria-label="Contributor to merge" className={SELECT} value={mergeId} onChange={(e) => setMergeId(e.target.value)}>
            <option value="">Choose…</option>
            {others.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
          </select>
          <Button variant="secondary" disabled={!mergeId} isLoading={merge.isPending} onClick={() => merge.mutate({ keep: data.id, merge: mergeId }, { onSuccess: () => setMergeId('') })}>Merge</Button>
          {conflict && <Button variant="danger" onClick={() => merge.mutate({ keep: data.id, merge: mergeId, force: true }, { onSuccess: () => setMergeId('') })}>Merge anyway</Button>}
        </div>
        {merge.error && <p className="text-small text-red">{conflict ? 'These have conflicting external identifiers; they look like different people.' : merge.error.message}</p>}
      </section>

      <div><Button variant="ghost" onClick={() => navigate('/contributors')}>Back to contributors</Button></div>
    </div>
  );
}
