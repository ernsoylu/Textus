import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import type { Json } from '@/types/database';
const object = (value: Json) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (value: Json | undefined) => typeof value === 'string' ? value : '';
export function AgentApprovals() {
  const client = useQueryClient();
  const actions = useQuery({ queryKey: ['agent-actions'], refetchInterval: 10_000, queryFn: async () => {
    const { data, error } = await supabase.from('agent_actions').select('id,tool,arguments,preview,status,expires_at,token_id,agent_tokens(name)').in('status', ['pending','approved']).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data;
  } });
  const review = useMutation({ mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
    const { error } = await supabase.rpc('review_agent_action', { p_action: id, p_approve: approve });
    if (error) throw error;
    await client.invalidateQueries({ queryKey: ['agent-actions'] });
  } });
  return <section aria-label="Agent write approvals" className="flex flex-col gap-3">
    <p className="text-body text-fg">Requested changes</p>
    <p className="text-small text-muted">Approve only changes you requested. Approval applies once to these exact arguments for 30 minutes. The agent must repeat the same request to execute it.</p>
    {(actions.error || review.error) && <p role="alert">Could not load or review requested changes.</p>}
    {actions.data?.length === 0 && <p className="text-small text-muted">No changes awaiting approval.</p>}
    <ul className="flex flex-col gap-3">{actions.data?.map((action) => {
      const args = object(action.arguments), preview = object(action.preview), work = object(preview.work ?? null), record = object(preview.record ?? null);
      const expired = new Date(action.expires_at).getTime() <= Date.now(), revoked = !action.token_id;
      const credits = Array.isArray(preview.credits) ? preview.credits.map((c) => text(object(c).display_name)).filter(Boolean).join(', ') : '';
      return <li key={action.id} className="rounded-8 border border-border p-3">
        <p className="text-small text-muted">{action.agent_tokens?.name ?? 'Revoked token'} · {revoked ? 'revoked' : expired ? 'expired' : action.status}</p>
        {action.tool === 'create_work_from_identifier' ? <>
          <p className="text-body text-fg">Create “{text(work.title)}” · {text(args.scheme).toUpperCase()}: {text(args.value)}</p>
          <p className="text-small text-muted">{credits}{text(record.publisher) ? ` · ${text(record.publisher)}` : ''}{text(record.publication_date) ? ` · ${text(record.publication_date)}` : ''} · {text(record.metadata_source)}</p>
          {text(work.abstract) && <details><summary>Abstract preview</summary><p className="text-small">{text(work.abstract)}</p></details>}
        </> : action.tool === 'add_file_from_url' ? <>
          <p className="text-body text-fg">Add a {text(args.role)} file to “{text(preview.recordTitle)}”</p>
          <p className="break-all text-small text-muted">{text(args.url)}</p>
        </> : <p className="text-body text-fg">{action.tool === 'tag_work' ? 'Apply tag' : 'Add to collection'} “{text(preview.targetName)}” for all records of “{text(preview.workTitle)}” (up to 100 records).</p>}
        <div className="mt-2 flex gap-2">
          {action.status === 'pending' && <Button disabled={expired || revoked || review.isPending} onClick={() => review.mutate({ id: action.id, approve: true })}>Approve once</Button>}
          <Button variant="ghost" disabled={expired || revoked || review.isPending} onClick={() => review.mutate({ id: action.id, approve: false })}>{action.status === 'approved' ? 'Withdraw approval' : 'Reject'}</Button>
        </div>
      </li>;
    })}</ul>
  </section>;
}
