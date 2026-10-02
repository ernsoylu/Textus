import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DUPLICATE_REASON_LABELS, findDuplicateWorks, mergeWorks } from '@/lib/duplicates';

// FR-CAT-7: warns when other works look like this one, and merges one into this work only when the owner confirms.
// Keyed under ['works'] so it refreshes after metadata import adds identifiers, titles and authors.
export function DuplicateNotice({ workId }: { workId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['works', workId, 'duplicates'], queryFn: () => findDuplicateWorks(workId) });
  const [confirming, setConfirming] = useState<string>();
  const merge = useMutation({
    mutationFn: (otherId: string) => mergeWorks(workId, otherId),
    onSuccess: () => { setConfirming(undefined); return queryClient.invalidateQueries({ queryKey: ['works'] }); },
  });
  if (!data?.length) return null;
  return (
    <section role="status" className="flex flex-col gap-2 rounded-8 border border-yellow bg-yellow-bg p-4 text-small text-fg">
      <p className="text-label">This may already be in your library</p>
      <ul className="flex flex-col gap-2">
        {data.map((other) => <li key={other.work_id} className="flex flex-wrap items-center gap-2">
          <span><Link to={`/library/${other.work_id}`} className="text-yellow underline">{other.title}</Link> <span className="text-muted">· {DUPLICATE_REASON_LABELS[other.reason] ?? other.reason}</span></span>
          {confirming === other.work_id
            ? <>
                <Button variant="danger" disabled={merge.isPending} onClick={() => merge.mutate(other.work_id)}>Confirm merge</Button>
                <Button variant="secondary" disabled={merge.isPending} onClick={() => setConfirming(undefined)}>Cancel</Button>
              </>
            : <Button variant="secondary" onClick={() => setConfirming(other.work_id)}>Merge into this book</Button>}
        </li>)}
      </ul>
      {confirming && <p className="text-muted">Its files, notes, tags and reading progress move here; the same file or identifier joins this edition, other editions are kept. This can’t be undone.</p>}
      {merge.isError && <p className="text-red">Could not merge these books. Try again.</p>}
    </section>
  );
}
