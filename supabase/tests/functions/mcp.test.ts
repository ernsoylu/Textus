const api = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const anon = Deno.env.get('ANON_KEY') ?? '';
const service = Deno.env.get('SERVICE_ROLE_KEY') ?? '';
const adminHeaders = { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function body(response: Response) { const text = await response.text(); if (!response.ok) throw new Error(`Fixture HTTP ${response.status}: ${text}`); return text ? JSON.parse(text) : null; }
async function hash(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), (b) => b.toString(16).padStart(2, '0')).join(''); }
Deno.test('MCP gateway validates transport, isolates owners and rejects revoked tokens', async () => {
  const users: string[] = [];
  const token = 'tx_' + Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  const headers = { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' };
  const call = (method: string, params: unknown, extra: Record<string, string> = {}) => fetch(`${api}/functions/v1/mcp`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }) });
  try {
    for (let i = 0; i < 2; i++) users.push((await body(await fetch(`${api}/auth/v1/admin/users`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ email: `m6-mcp-${crypto.randomUUID()}@example.test`, email_confirm: true }) }))).id);
    const work = (await body(await fetch(`${api}/rest/v1/works`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ user_id: users[0], title: 'Agent owned fixture', work_type: 'book' }) })))[0];
    const foreign = (await body(await fetch(`${api}/rest/v1/works`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ user_id: users[1], title: 'Another owner secret', work_type: 'book' }) })))[0];
    const row = (await body(await fetch(`${api}/rest/v1/agent_tokens`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ user_id: users[0], name: 'MCP fixture', token_hash: await hash(token), token_prefix: token.slice(0, 9), scope: 'read' }) })))[0];
    const initialized = await body(await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Textus fixture', version: '1' } }));
    if (!initialized.result?.serverInfo || initialized.result.protocolVersion !== '2025-11-25') throw new Error('initialize failed');
    const listed = await body(await call('tools/list', {}));
    if (!listed.result?.tools.some((tool: { name: string }) => tool.name === 'get_work') || listed.result.tools.some((tool: { name: string }) => tool.name === 'tag_work')) throw new Error('read-only discovery failed');
    const own = await body(await call('tools/call', { name: 'get_work', arguments: { workId: work.id } }));
    if (own.result?.isError || !JSON.stringify(own).includes('Agent owned fixture')) throw new Error(`own RLS read failed: ${JSON.stringify(own)}`);
    const denied = await body(await call('tools/call', { name: 'get_work', arguments: { workId: foreign.id } }));
    if (!denied.result?.isError || JSON.stringify(denied).includes('Another owner secret')) throw new Error('foreign work leaked');
    for (const [extra, expected] of [[{ Origin: 'https://evil.example' }, 403], [{ 'MCP-Protocol-Version': '1999-01-01' }, 400]] as const) {
      const response = await call('tools/list', {}, extra); await response.text(); if (response.status !== expected) throw new Error(`transport accepted invalid headers (${response.status})`);
    }
    const oversized = await fetch(`${api}/functions/v1/mcp`, { method: 'POST', headers, body: ' '.repeat(33000) }); await oversized.text();
    if (oversized.status !== 413) throw new Error('oversized MCP body accepted');
    await body(await fetch(`${api}/rest/v1/agent_tokens?id=eq.${row.id}`, { method: 'DELETE', headers: adminHeaders }));
    const revoked = await call('tools/list', {}); await revoked.text(); if (revoked.status !== 401) throw new Error('revoked token authenticated');
  } finally { for (const id of users) await fetch(`${api}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: adminHeaders }); }
});

Deno.test('MCP writes require owner approval, reject confirmation flags and replay exactly', async () => {
  const email = `m6-writer-${crypto.randomUUID()}@example.test`, password = crypto.randomUUID();
  const user = await body(await fetch(`${api}/auth/v1/admin/users`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ email, password, email_confirm: true }) }));
  try {
    const session = await body(await fetch(`${api}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }));
    const ownerHeaders = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
    const work = (await body(await fetch(`${api}/rest/v1/works`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ user_id: user.id, title: 'Approved write fixture', work_type: 'book' }) })))[0];
    const record = (await body(await fetch(`${api}/rest/v1/records`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ work_id: work.id, record_type: 'edition' }) })))[0];
    const tag = (await body(await fetch(`${api}/rest/v1/tags`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ user_id: user.id, name: 'Approved fixture tag' }) })))[0];
    const token = 'tx_' + Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
    const tokenRow = (await body(await fetch(`${api}/rest/v1/agent_tokens`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ user_id: user.id, name: 'Writer fixture', token_hash: await hash(token), token_prefix: token.slice(0, 9), scope: 'read_write' }) })))[0];
    const headers = { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' };
    const call = async (name: string, args: unknown) => await body(await fetch(`${api}/functions/v1/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/call', params: { name, arguments: args } }) }));
    const args = { requestId: crypto.randomUUID(), workId: work.id, tagId: tag.id };
    const confirmation = await call('tag_work', { ...args, confirmed: true });
    if (!confirmation.result?.isError) throw new Error('Agent confirmation flag accepted');
    const pending = await call('tag_work', args);
    if (pending.result?.isError) throw new Error(`Proposal failed: ${JSON.stringify(pending)}`);
    const proposed = JSON.parse(pending.result.content[0].text).data;
    if (proposed.status !== 'pending' || proposed.preview.workTitle !== work.title || proposed.preview.targetName !== tag.name) throw new Error('Readable pending approval missing');
    const memberships = await body(await fetch(`${api}/rest/v1/record_tags?record_id=eq.${record.id}`, { headers: adminHeaders }));
    if (memberships.length) throw new Error('Pending action mutated catalog');
    await body(await fetch(`${api}/rest/v1/rpc/review_agent_action`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ p_action: proposed.actionId, p_approve: true }) }));
    const executed = await call('tag_work', args), replay = await call('tag_work', args);
    if (executed.result?.isError || JSON.parse(executed.result.content[0].text).data.status !== 'applied' || JSON.stringify(executed.result) !== JSON.stringify(replay.result)) throw new Error('Approved write/replay failed');
    const changed = await call('tag_work', { ...args, tagId: crypto.randomUUID() });
    if (!changed.result?.isError) throw new Error('Changed request arguments accepted');
    const downloadArgs = { requestId: crypto.randomUUID(), recordId: record.id, url: 'https://example.com/', role: 'supplement' };
    const download = JSON.parse((await call('add_file_from_url', downloadArgs)).result.content[0].text).data;
    if (download.status !== 'pending') throw new Error('URL request lacked owner approval');
    await body(await fetch(`${api}/rest/v1/rpc/review_agent_action`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ p_action: download.actionId, p_approve: true }) }));
    if (Deno.env.get('TEXTUS_LIVE_URL_TEST') === 'true') {
      const fetched = await call('add_file_from_url', downloadArgs);
      const result = fetched.result?.content?.[0] ? JSON.parse(fetched.result.content[0].text).data : null;
      if (fetched.result?.isError || !['created','deduplicated'].includes(result?.status)) throw new Error(`Approved public URL transfer failed: ${JSON.stringify(fetched)}`);
      const linked = await body(await fetch(`${api}/rest/v1/record_assets?record_id=eq.${record.id}`, { headers: adminHeaders }));
      if (linked.length !== 1) throw new Error('Approved URL did not link exactly one asset');
      console.log('Approved MCP public URL transfer passed.');
      const badTlsArgs = { ...downloadArgs, requestId: crypto.randomUUID(), url: 'https://wrong.host.badssl.com/' };
      const badTls = JSON.parse((await call('add_file_from_url', badTlsArgs)).result.content[0].text).data;
      await body(await fetch(`${api}/rest/v1/rpc/review_agent_action`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ p_action: badTls.actionId, p_approve: true }) }));
      const rejectedTls = JSON.parse((await call('add_file_from_url', badTlsArgs)).result.content[0].text).data;
      if (rejectedTls.status !== 'rejected') throw new Error('Invalid TLS certificate was accepted');
      console.log('MCP invalid TLS destination rejected.');
      downloadArgs.requestId = crypto.randomUUID();
      const next = JSON.parse((await call('add_file_from_url', downloadArgs)).result.content[0].text).data;
      await body(await fetch(`${api}/rest/v1/rpc/review_agent_action`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ p_action: next.actionId, p_approve: true }) }));
    }
    // Revocation must prevent an already approved download from executing through the gateway.
    await body(await fetch(`${api}/rest/v1/agent_tokens?id=eq.${tokenRow.id}`, { method: 'DELETE', headers: adminHeaders }));
    const revoked = await fetch(`${api}/functions/v1/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add_file_from_url', arguments: downloadArgs } }) });
    await revoked.text(); if (revoked.status !== 401) throw new Error('Revoked write token authenticated');
  } finally {
    const assets = await body(await fetch(`${api}/rest/v1/assets?user_id=eq.${user.id}&select=bucket,storage_path`, { headers: adminHeaders }));
    for (const asset of assets) await fetch(`${api}/storage/v1/object/${asset.bucket}`, { method: 'DELETE', headers: adminHeaders, body: JSON.stringify({ prefixes: [asset.storage_path] }) });
    await fetch(`${api}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: adminHeaders });
  }
});
