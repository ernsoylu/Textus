import { textPdf } from '../fixtures/pdf.ts';
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
    // Both owners hold the same ISBN; check_duplicates must report only the caller's work.
    for (const owned of [work, foreign]) {
      const record = (await body(await fetch(`${api}/rest/v1/records`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ work_id: owned.id, record_type: 'edition' }) })))[0];
      await body(await fetch(`${api}/rest/v1/identifiers`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ record_id: record.id, scheme: 'isbn', normalized_value: '9780306406157', original_value: '9780306406157' }) }));
    }
    await body(await fetch(`${api}/rest/v1/tags`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ user_id: users[1], name: 'Another owner tag' }) }));
    const row = (await body(await fetch(`${api}/rest/v1/agent_tokens`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ user_id: users[0], name: 'MCP fixture', token_hash: await hash(token), token_prefix: token.slice(0, 9), scope: 'read' }) })))[0];
    const initialized = await body(await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Textus fixture', version: '1' } }));
    if (!initialized.result?.serverInfo || initialized.result.protocolVersion !== '2025-11-25') throw new Error('initialize failed');
    const listed = await body(await call('tools/list', {}));
    if (!listed.result?.tools.some((tool: { name: string }) => tool.name === 'get_work') || listed.result.tools.some((tool: { name: string }) => tool.name === 'tag_work')) throw new Error('read-only discovery failed');
    const own = await body(await call('tools/call', { name: 'get_work', arguments: { workId: work.id } }));
    if (own.result?.isError || !JSON.stringify(own).includes('Agent owned fixture')) throw new Error(`own RLS read failed: ${JSON.stringify(own)}`);
    const denied = await body(await call('tools/call', { name: 'get_work', arguments: { workId: foreign.id } }));
    if (!denied.result?.isError || JSON.stringify(denied).includes('Another owner secret')) throw new Error('foreign work leaked');
    const data = (response: { result: { content: { text: string }[] } }) => JSON.parse(response.result.content[0].text).data;
    const duplicates = data(await body(await call('tools/call', { name: 'check_duplicates', arguments: { scheme: 'isbn', value: '978-0-306-40615-7' } })));
    if (duplicates.matches.length !== 1 || duplicates.matches[0].workId !== work.id || duplicates.matches[0].reason !== 'identifier') throw new Error(`check_duplicates failed: ${JSON.stringify(duplicates)}`);
    const ambiguous = await body(await call('tools/call', { name: 'check_duplicates', arguments: { scheme: 'isbn', value: '9780306406157', workId: work.id } }));
    if (!ambiguous.result?.isError) throw new Error('check_duplicates accepted two lookups at once');
    const tags = data(await body(await call('tools/call', { name: 'list_tags', arguments: {} })));
    if (!Array.isArray(tags) || JSON.stringify(tags).includes('Another owner tag')) throw new Error('list_tags leaked another owner\'s tags');
    for (const [extra, expected] of [[{ Origin: 'https://evil.example' }, 403], [{ 'MCP-Protocol-Version': '1999-01-01' }, 400]] as const) {
      const response = await call('tools/list', {}, extra); await response.text(); if (response.status !== expected) throw new Error(`transport accepted invalid headers (${response.status})`);
    }
    const oversized = await fetch(`${api}/functions/v1/mcp`, { method: 'POST', headers, body: ' '.repeat(33000) }); await oversized.text();
    if (oversized.status !== 413) throw new Error('oversized MCP body accepted');
    await body(await fetch(`${api}/rest/v1/agent_tokens?id=eq.${row.id}`, { method: 'DELETE', headers: adminHeaders }));
    const revoked = await call('tools/list', {}); await revoked.text(); if (revoked.status !== 401) throw new Error('revoked token authenticated');
  } finally { for (const id of users) await fetch(`${api}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: adminHeaders }); }
});

Deno.test('MCP read_write tokens write directly, reject confirmation flags, replay exactly and appear in book history', async () => {
  const email = `m6-writer-${crypto.randomUUID()}@example.test`, password = crypto.randomUUID();
  const user = await body(await fetch(`${api}/auth/v1/admin/users`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ email, password, email_confirm: true }) }));
  try {
    const session = await body(await fetch(`${api}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }));
    const ownerHeaders = { apikey: anon, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
    const work = (await body(await fetch(`${api}/rest/v1/works`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ user_id: user.id, title: 'Agent write fixture', work_type: 'book' }) })))[0];
    const record = (await body(await fetch(`${api}/rest/v1/records`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ work_id: work.id, record_type: 'edition' }) })))[0];
    const tag = (await body(await fetch(`${api}/rest/v1/tags`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ user_id: user.id, name: 'Agent fixture tag' }) })))[0];
    const token = 'tx_' + Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
    const tokenRow = (await body(await fetch(`${api}/rest/v1/agent_tokens`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ user_id: user.id, name: 'Writer fixture', token_hash: await hash(token), token_prefix: token.slice(0, 9), scope: 'read_write' }) })))[0];
    const headers = { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' };
    const call = async (name: string, args: unknown) => await body(await fetch(`${api}/functions/v1/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/call', params: { name, arguments: args } }) }));
    const args = { requestId: crypto.randomUUID(), workId: work.id, tagId: tag.id };
    const confirmation = await call('tag_work', { ...args, confirmed: true });
    if (!confirmation.result?.isError) throw new Error('Agent confirmation flag accepted');
    // A read_write token is the owner's approval: the write applies on the first call and replays exactly.
    const executed = await call('tag_work', args), replay = await call('tag_work', args);
    if (executed.result?.isError || JSON.parse(executed.result.content[0].text).data.status !== 'applied' || JSON.stringify(executed.result) !== JSON.stringify(replay.result)) throw new Error(`Direct write/replay failed: ${JSON.stringify(executed)}`);
    const memberships = await body(await fetch(`${api}/rest/v1/record_tags?record_id=eq.${record.id}`, { headers: adminHeaders }));
    if (memberships.length !== 1) throw new Error('Write did not link exactly one tag');
    const history = await body(await fetch(`${api}/rest/v1/work_events?work_id=eq.${work.id}&event=eq.tag.added&select=actor,actor_detail`, { headers: ownerHeaders }));
    if (history.length !== 1 || history[0].actor !== 'agent' || history[0].actor_detail !== 'Writer fixture') throw new Error(`Agent write missing from book history: ${JSON.stringify(history)}`);
    const changed = await call('tag_work', { ...args, tagId: crypto.randomUUID() });
    if (!changed.result?.isError) throw new Error('Changed request arguments accepted');
    // A known identifier returns the catalogued work instead of creating a second one, before any provider lookup.
    await body(await fetch(`${api}/rest/v1/identifiers`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ record_id: record.id, scheme: 'isbn', normalized_value: '9780306406157', original_value: '9780306406157' }) }));
    const existing = await call('create_work_from_identifier', { requestId: crypto.randomUUID(), scheme: 'isbn', value: '9780306406157' });
    const existingData = existing.result?.content?.[0] ? JSON.parse(existing.result.content[0].text).data : null;
    if (existingData?.status !== 'existing' || existingData.workId !== work.id) throw new Error(`Known identifier created a duplicate: ${JSON.stringify(existing)}`);
    const downloadArgs = { requestId: crypto.randomUUID(), recordId: record.id, url: 'https://example.com/', role: 'supplement' };
    if (Deno.env.get('TEXTUS_LIVE_URL_TEST') === 'true') {
      const fetched = await call('add_file_from_url', downloadArgs);
      const result = fetched.result?.content?.[0] ? JSON.parse(fetched.result.content[0].text).data : null;
      if (fetched.result?.isError || !['created','deduplicated'].includes(result?.status)) throw new Error(`Public URL transfer failed: ${JSON.stringify(fetched)}`);
      const linked = await body(await fetch(`${api}/rest/v1/record_assets?record_id=eq.${record.id}`, { headers: adminHeaders }));
      if (linked.length !== 1) throw new Error('URL did not link exactly one asset');
      console.log('MCP public URL transfer passed.');
      const rejectedTls = JSON.parse((await call('add_file_from_url', { ...downloadArgs, requestId: crypto.randomUUID(), url: 'https://wrong.host.badssl.com/' })).result.content[0].text).data;
      if (rejectedTls.status !== 'rejected') throw new Error('Invalid TLS certificate was accepted');
      console.log('MCP invalid TLS destination rejected.');
      downloadArgs.requestId = crypto.randomUUID();
    }
    // create_work + upload_file: an owner-supplied title becomes a work, and local bytes go through a signed staging URL
    // and the normal finalizer. Both replay; a reused contributorId credits the same person.
    const result = (response: { result: { content: { text: string }[] } }) => JSON.parse(response.result.content[0].text).data;
    const workArgs = { requestId: crypto.randomUUID(), title: 'Agent upload fixture', authors: [{ name: 'Ada Lovelace' }] };
    const created = result(await call('create_work', workArgs));
    if (created.status !== 'created' || JSON.stringify(result(await call('create_work', workArgs))) !== JSON.stringify(created)) throw new Error(`create_work failed or did not replay: ${JSON.stringify(created)}`);
    const credit = await body(await fetch(`${api}/rest/v1/record_contributors?record_id=eq.${created.recordId}&select=contributor_id,contributors(display_name,status)`, { headers: adminHeaders }));
    if (credit.length !== 1 || credit[0].contributors.display_name !== 'Ada Lovelace' || credit[0].contributors.status !== 'provisional') throw new Error(`create_work credit wrong: ${JSON.stringify(credit)}`);
    const second = result(await call('create_work', { requestId: crypto.randomUUID(), title: 'Second agent fixture', authors: [{ contributorId: credit[0].contributor_id }] }));
    const reused = await body(await fetch(`${api}/rest/v1/record_contributors?record_id=eq.${second.recordId}&select=contributor_id`, { headers: adminHeaders }));
    if (reused[0]?.contributor_id !== credit[0].contributor_id) throw new Error('contributorId was not reused');
    const pdf = textPdf();
    const uploadArgs = { requestId: crypto.randomUUID(), recordId: created.recordId, filename: 'fixture.pdf', size: pdf.length };
    const pending = result(await call('upload_file', uploadArgs));
    if (pending.status !== 'upload_required' || !pending.uploadUrl) throw new Error(`upload_file did not issue a URL: ${JSON.stringify(pending)}`);
    // The URL names the public origin; the test reaches the same gateway locally.
    const put = await fetch(`${api}${new URL(pending.uploadUrl).pathname}${new URL(pending.uploadUrl).search}`, { method: 'PUT', headers: pending.headers, body: pdf });
    await put.text(); if (!put.ok) throw new Error(`signed staging PUT failed: ${put.status}`);
    const uploaded = result(await call('upload_file', uploadArgs));
    if (uploaded.status !== 'created' || JSON.stringify(result(await call('upload_file', uploadArgs))) !== JSON.stringify(uploaded)) throw new Error(`upload_file did not finish or replay: ${JSON.stringify(uploaded)}`);
    const attached = await body(await fetch(`${api}/rest/v1/record_assets?record_id=eq.${created.recordId}&role=eq.primary`, { headers: adminHeaders }));
    if (attached.length !== 1) throw new Error('upload_file did not link exactly one asset');
    const againArgs = { ...uploadArgs, requestId: crypto.randomUUID(), recordId: second.recordId };
    const again = result(await call('upload_file', againArgs));
    const putAgain = await fetch(`${api}${new URL(again.uploadUrl).pathname}${new URL(again.uploadUrl).search}`, { method: 'PUT', headers: again.headers, body: pdf }); await putAgain.text();
    const duplicate = result(await call('upload_file', againArgs));
    if (duplicate.status !== 'duplicate' || duplicate.workId !== created.workId) throw new Error(`same file in another work was not rejected: ${JSON.stringify(duplicate)}`);
    // A revoked token stops writing at once.
    await body(await fetch(`${api}/rest/v1/agent_tokens?id=eq.${tokenRow.id}`, { method: 'DELETE', headers: adminHeaders }));
    const revoked = await fetch(`${api}/functions/v1/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add_file_from_url', arguments: downloadArgs } }) });
    await revoked.text(); if (revoked.status !== 401) throw new Error('Revoked write token authenticated');
  } finally {
    const assets = await body(await fetch(`${api}/rest/v1/assets?user_id=eq.${user.id}&select=bucket,storage_path`, { headers: adminHeaders }));
    for (const asset of assets) await fetch(`${api}/storage/v1/object/${asset.bucket}`, { method: 'DELETE', headers: adminHeaders, body: JSON.stringify({ prefixes: [asset.storage_path] }) });
    await fetch(`${api}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: adminHeaders });
  }
});
