import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useSetContainer } from '@/hooks/useCatalogMutations';

// FR-CONTRIB-10: a chapter or article can be "part of" another record (edited volume, issue).
// The container's editors are read from the container at citation time, never copied here (§6.3).
export function ContainerPicker({ workId, recordId, containerId }: { workId: string; recordId: string; containerId: string | null }) {
  const setContainer = useSetContainer(workId);
  const candidates = useQuery({
    queryKey: ['container-candidates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('records').select('id, title, record_type, volume, issue_number, works(title)').in('record_type', ['edition', 'issue']).order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return data;
    },
  });
  const label = (r: NonNullable<typeof candidates.data>[number]) =>
    [r.title || r.works?.title || 'Untitled', r.record_type === 'issue' ? [r.volume && `vol. ${r.volume}`, r.issue_number && `no. ${r.issue_number}`].filter(Boolean).join(' ') : ''].filter(Boolean).join(' · ');
  return (
    <label className="flex flex-wrap items-center gap-2 text-small text-fg">
      Part of
      <select
        aria-label="Container record"
        className="rounded-8 border border-muted bg-dim p-2 text-body text-fg"
        value={containerId ?? ''}
        onChange={(e) => setContainer.mutate({ recordId, containerId: e.target.value || null })}
      >
        <option value="">— none —</option>
        {candidates.data?.filter((r) => r.id !== recordId).map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}
      </select>
      {setContainer.error && <span className="text-red">{setContainer.error.message}</span>}
    </label>
  );
}
