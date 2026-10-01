import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { DUPLICATE_REASON_LABELS, findDuplicateWorks } from '@/lib/duplicates';

// FR-CAT-7: warns — never merges — when other works look like this one. Keyed under ['works'] so it refreshes after
// metadata import adds identifiers, titles and authors.
export function DuplicateNotice({ workId }: { workId: string }) {
  const { data } = useQuery({ queryKey: ['works', workId, 'duplicates'], queryFn: () => findDuplicateWorks(workId) });
  if (!data?.length) return null;
  return (
    <section role="status" className="flex flex-col gap-2 rounded-8 border border-yellow bg-yellow-bg p-4 text-small text-fg">
      <p className="text-label">This may already be in your library</p>
      <ul className="flex flex-col gap-1">
        {data.map((other) => <li key={other.work_id}><Link to={`/library/${other.work_id}`} className="text-yellow underline">{other.title}</Link> <span className="text-muted">· {DUPLICATE_REASON_LABELS[other.reason] ?? other.reason}</span></li>)}
      </ul>
    </section>
  );
}
