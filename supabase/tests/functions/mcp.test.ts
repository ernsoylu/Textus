const api = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const anon = Deno.env.get('ANON_KEY') ?? '';
const service = Deno.env.get('SERVICE_ROLE_KEY') ?? '';
const adminHeaders = { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
async function body(response: Response) { if (!response.ok) throw new Error(`Fixture HTTP ${response.status}: ${await response.text()}`); return await response.json(); }
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
