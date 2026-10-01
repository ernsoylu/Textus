import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { aiStatus } from '@/lib/functions';
import { useAuth } from '@/hooks/useAuth';
import { supabase, supabaseUrl } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AgentApprovals } from './AgentApprovals';
export function AgentTab() {
  const { session } = useAuth();
  const client = useQueryClient();
  const [name, setName] = useState('Hermes');
  const [days, setDays] = useState(30);
  const [scope, setScope] = useState<'read' | 'read_write'>('read');
  const [secret, setSecret] = useState<string>();
  const [copyMessage, setCopyMessage] = useState('');
  const status = useQuery({ queryKey: ['ai', 'status'], queryFn: aiStatus });
  const tokens = useQuery({ queryKey: ['agent-tokens'], queryFn: async () => {
    const { data, error } = await supabase.from('agent_tokens').select('id,name,token_prefix,scope,expires_at,last_used_at,created_at').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data;
  } });
  const create = useMutation({ mutationFn: async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = 'tx_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    const { error } = await supabase.from('agent_tokens').insert({ user_id: session!.user.id, name: name.trim(), token_hash: hash, token_prefix: token.slice(0, 9), scope, expires_at: days ? new Date(Date.now() + days * 86400000).toISOString() : null });
    if (error) throw error;
    setSecret(token); setCopyMessage('');
    await client.invalidateQueries({ queryKey: ['agent-tokens'] });
    await client.invalidateQueries({ queryKey: ['agent-actions'] });
  } });
  const revoke = useMutation({ mutationFn: async (id: string) => {
    const { error } = await supabase.from('agent_tokens').delete().eq('id', id);
    if (error) throw error;
    setSecret(undefined);
    await client.invalidateQueries({ queryKey: ['agent-tokens'] });
  } });
  return <div className="flex flex-col gap-4">
    <p className="text-body text-muted">Connect Hermes or another MCP client to your private library. Read access is the default. Every write requires your separate approval here.</p>
    {status.data && !status.data.agentsEnabled && <p role="status">Agent access is disabled by the administrator. You can prepare a token before it is enabled.</p>}
    {status.data?.agentsEnabled && scope === 'read_write' && !status.data.agentWritesEnabled && <p role="status">Write tools are disabled by the administrator. You can prepare an approval-required token before they are enabled.</p>}
    <label className="text-small text-fg">MCP URL<Input value={`${supabaseUrl}/functions/v1/mcp`} readOnly /></label>
    <label className="text-small text-fg">Token name<Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
    <label className="text-small text-fg">Access<select aria-label="Agent token access" value={scope} onChange={(e) => setScope(e.target.value as 'read' | 'read_write')} className="mt-2 w-full rounded-8 border border-border bg-dim p-3"><option value="read">Read only</option><option value="read_write">Read and propose owner-approved writes</option></select></label>
    <label className="text-small text-fg">Expires<select aria-label="Token expiration" value={days} onChange={(e) => setDays(Number(e.target.value))} className="mt-2 w-full rounded-8 border border-border bg-dim p-3">
      <option value={7}>In 7 days</option><option value={30}>In 30 days</option><option value={90}>In 90 days</option><option value={0}>No expiry</option>
    </select></label>
    <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>{scope === 'read' ? 'Create read token' : 'Create write token'}</Button>
    {secret && <div className="flex flex-col gap-2 rounded-8 border border-border p-3">
      <p role="status" className="text-small text-fg">Copy this token now. It is shown once and only its hash is stored.</p>
      <label className="text-small text-fg">New agent token<Input autoComplete="off" value={secret} readOnly /></label>
      <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(secret); setCopyMessage('Copied.'); } catch { setCopyMessage('Copy failed. Select and copy the token manually.'); } }}>Copy token</Button>
      <Button variant="ghost" onClick={() => setSecret(undefined)}>Dismiss token</Button>
      {copyMessage && <p role="status">{copyMessage}</p>}
    </div>}
    {(tokens.error || create.error || revoke.error) && <p role="alert">Could not load or change agent tokens.</p>}
    <ul className="flex flex-col gap-2">{tokens.data?.map((token) => <li key={token.id} className="rounded-8 border border-border p-3">
      <p className="text-body text-fg">{token.name} · {token.token_prefix}… · {token.scope}</p>
      <p className="text-small text-muted">{token.expires_at ? `Expires ${new Date(token.expires_at).toLocaleDateString()}` : 'No expiry'} · Last used: {token.last_used_at ? new Date(token.last_used_at).toLocaleString() : 'Never'}</p>
      <Button variant="ghost" disabled={revoke.isPending} aria-label={`Revoke ${token.name}`} onClick={() => revoke.mutate(token.id)}>Revoke</Button>
    </li>)}</ul>
    <AgentApprovals />
  </div>;
}
