import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, supabaseUrl } from '@/lib/supabase';
import { newSecretToken } from '@/lib/tokens';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const ONLINE_MS = 15 * 60_000; // workers renew their session about every 7 minutes

export function WorkersTab() {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [serverUrl, setServerUrl] = useState(supabaseUrl);
  const [command, setCommand] = useState<string>();
  const [copyMessage, setCopyMessage] = useState('');
  const workers = useQuery({ queryKey: ['workers'], queryFn: async () => {
    const { data, error } = await supabase.from('workers').select('id,name,token_prefix,last_seen_at,created_at').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data;
  } });
  const create = useMutation({ mutationFn: async () => {
    const { token, hash, prefix } = await newSecretToken('tw_');
    const { error } = await supabase.from('workers').insert({ name: name.trim(), token_hash: hash, token_prefix: prefix });
    if (error) throw error;
    setCommand(`docker build -t textus-worker -f deploy/worker.Dockerfile https://github.com/ernsoylu/Textus.git#main\ndocker run -d --name textus-worker --restart unless-stopped \\\n  -e TEXTUS_URL=${serverUrl.trim().replace(/\/+$/, '')} \\\n  -e TEXTUS_WORKER_TOKEN=${token} \\\n  textus-worker`);
    setCopyMessage(''); setName('');
    await client.invalidateQueries({ queryKey: ['workers'] });
  } });
  const revoke = useMutation({ mutationFn: async (id: string) => {
    const { error } = await supabase.from('workers').delete().eq('id', id);
    if (error) throw error;
    await client.invalidateQueries({ queryKey: ['workers'] });
  } });
  return <div className="flex flex-col gap-4">
    <p className="text-body text-muted">Run text extraction, indexing, metadata lookup and cover jobs on other servers in parallel. Each worker is a Docker container that connects to this server with its own token. A worker can read every library’s files and catalog on this server and write processing results, but not accounts, tokens, notes or deletions. Register only machines you control; revoking stops it within minutes.</p>
    <label className="text-small text-fg">Server URL the worker can reach<Input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} /></label>
    <label className="text-small text-fg">Worker name<Input value={name} maxLength={100} placeholder="app101" onChange={(e) => setName(e.target.value)} /></label>
    <Button disabled={!name.trim() || !/^https?:\/\/\S+$/.test(serverUrl.trim()) || create.isPending} onClick={() => create.mutate()}>Register worker</Button>
    {command && <div className="flex flex-col gap-2 rounded-8 border border-border p-3">
      <p role="status" className="text-small text-fg">Run this on the worker host. The token is shown once and only its hash is stored. Add OLLAMA_URL and AI_ENABLED=true to let it run AI jobs, and WORKER_CONCURRENCY to run more than two jobs at once.</p>
      <label className="text-small text-fg">Worker command<textarea aria-label="Worker command" readOnly value={command} rows={6} className="mt-2 w-full rounded-8 border border-border bg-dim p-3 font-mono text-small" /></label>
      <Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(command); setCopyMessage('Copied.'); } catch { setCopyMessage('Copy failed. Select and copy the command manually.'); } }}>Copy command</Button>
      <Button variant="ghost" onClick={() => setCommand(undefined)}>Dismiss command</Button>
      {copyMessage && <p role="status">{copyMessage}</p>}
    </div>}
    {(workers.error || create.error || revoke.error) && <p role="alert">Could not load or change workers.</p>}
    <ul className="flex flex-col gap-2">{workers.data?.map((worker) => {
      const online = !!worker.last_seen_at && Date.now() - new Date(worker.last_seen_at).getTime() < ONLINE_MS;
      return <li key={worker.id} className="rounded-8 border border-border p-3">
        <p className="text-body text-fg">{worker.name} · {worker.token_prefix}… · <span className={online ? 'text-green' : 'text-muted'}>{online ? 'Online' : 'Offline'}</span></p>
        <p className="text-small text-muted">Last seen: {worker.last_seen_at ? new Date(worker.last_seen_at).toLocaleString() : 'Never'}</p>
        <Button variant="ghost" disabled={revoke.isPending} aria-label={`Revoke ${worker.name}`} onClick={() => revoke.mutate(worker.id)}>Revoke</Button>
      </li>;
    })}</ul>
  </div>;
}
