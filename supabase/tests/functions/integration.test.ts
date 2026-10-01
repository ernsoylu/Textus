import { tenPagePdf } from '../fixtures/pdf.ts';
const api = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('ANON_KEY') ?? '';
const workerKey = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SECRET_KEY') ?? '';
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';

function headers(token: string, key = anon): HeadersInit {
  return { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

Deno.test('upload, export and OPDS work through the local function gateway', async () => {
  if (!anon || !service) throw new Error('Set ANON_KEY and SERVICE_ROLE_KEY (supabase status -o env).');

  const suffix = crypto.randomUUID();
  const email = `phase7-${suffix}@example.test`;
  const password = `Textus-${suffix}-Aa9!`;
  let userId: string | undefined;
  try {
    const created = await fetch(`${api}/auth/v1/admin/users`, {
      method: 'POST',
      headers: headers(service, service),
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!created.ok) throw new Error(`create test user failed (${created.status})`);
    userId = (await created.json()).id;

    const login = await fetch(`${api}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
    });
    if (!login.ok) throw new Error(`sign in test user failed (${login.status})`);
    const accessToken = (await login.json()).access_token as string;

    const workResponse = await fetch(`${api}/rest/v1/works`, {
      method: 'POST', headers: { ...headers(accessToken), Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: userId, work_type: 'book', title: `Phase 7 ${suffix}` }),
    });
    if (!workResponse.ok) throw new Error(`create test work failed (${workResponse.status})`);
    const work = (await workResponse.json())[0];
    const recordResponse = await fetch(`${api}/rest/v1/records`, {
      method: 'POST', headers: { ...headers(accessToken), Prefer: 'return=representation' },
      body: JSON.stringify({ work_id: work.id, record_type: 'edition' }),
    });
    if (!recordResponse.ok) throw new Error(`create test record failed (${recordResponse.status})`);
    const recordId = (await recordResponse.json())[0].id as string;

    const bytes = tenPagePdf();
    const uploadId = crypto.randomUUID();
    const intentResponse = await fetch(`${api}/functions/v1/upload/intent`, {
      method: 'POST', headers: headers(accessToken),
      body: JSON.stringify({ uploadId, recordId, filename: 'fixture.pdf', size: bytes.length }),
    });
    if (!intentResponse.ok) throw new Error(`upload intent failed (${intentResponse.status}): ${await intentResponse.text()}`);
    const intent = await intentResponse.json();
    const put = await fetch(`${api}/storage/v1/object/upload/sign/staging/${intent.path}?token=${encodeURIComponent(intent.token)}`, {
      method: 'PUT', headers: { apikey: anon, 'Content-Type': 'application/pdf' }, body: bytes,
    });
    if (!put.ok) throw new Error(`staging upload failed (${put.status})`);
    const complete = await fetch(`${api}/functions/v1/upload/complete`, {
      method: 'POST', headers: headers(accessToken), body: JSON.stringify({ uploadId, recordId, role: 'primary', filename: 'fixture.pdf' }),
    });
    if (!complete.ok || (await complete.json()).status !== 'created') throw new Error(`upload completion failed (${complete.status})`);

    // Real Edge runtime: extraction queues full indexing, then resumable batches expose page nine.
    let indexed = false;
    for (let attempt = 0; attempt < 25; attempt++) {
      const worker = await fetch(`${api}/functions/v1/job-worker`, { method: 'POST', headers: headers(service, workerKey) });
      if (!worker.ok) throw new Error(`worker invocation failed (${worker.status}): ${await worker.text()}`);
      await worker.json();
      const passages = await fetch(`${api}/rest/v1/rpc/search_passages`, { method: 'POST', headers: headers(accessToken), body: JSON.stringify({ p_query: 'Photovoltaic', p_work_ids: [work.id] }) });
      if (!passages.ok) throw new Error(`passage search failed (${passages.status})`);
      if ((await passages.json()).some((p: {page: number}) => p.page === 9)) { indexed = true; break; }
    }
    if (!indexed) {
      const jobs = await fetch(`${api}/rest/v1/jobs?user_id=eq.${userId}&select=job_type,status,last_error,payload,result`, { headers: headers(service, service) });
      throw new Error(`real Edge worker did not expose page-nine evidence: ${JSON.stringify(await jobs.json())}`);
    }

    const exported = await fetch(`${api}/functions/v1/export`, {
      method: 'POST', headers: headers(accessToken), body: JSON.stringify({ recordIds: [recordId], format: 'bibtex' }),
    });
    const exportBody = await exported.json();
    if (!exported.ok || exportBody.count !== 1 || !exportBody.content.includes(`Phase 7 ${suffix}`)) throw new Error(`citation export failed (${exported.status})`);

    const passwordFeed = await fetch(`${api}/functions/v1/opds`, { headers: { Authorization: `Basic ${btoa(`${email}:${password}`)}`, apikey: anon } });
    await passwordFeed.body?.cancel();
    if (passwordFeed.status !== 401) throw new Error(`OPDS accepted an account password (${passwordFeed.status})`);
    const opdsToken = `tx_${Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
    const tokenHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(opdsToken))), (b) => b.toString(16).padStart(2, '0')).join('');
    const minted = await fetch(`${api}/rest/v1/agent_tokens`, { method: 'POST', headers: headers(service, service), body: JSON.stringify({ user_id: userId, name: 'OPDS fixture', token_hash: tokenHash, token_prefix: opdsToken.slice(0, 9), scope: 'read' }) });
    await minted.body?.cancel();
    if (!minted.ok) throw new Error(`OPDS token fixture failed (${minted.status})`);
    const opds = await fetch(`${api}/functions/v1/opds`, {
      headers: { Authorization: `Basic ${btoa(`reader:${opdsToken}`)}`, apikey: anon },
    });
    const feed = await opds.text();
    if (!opds.ok || !feed.includes('All titles') || !feed.includes('Collections')) throw new Error(`OPDS start feed failed (${opds.status})`);
  } finally {
    if (userId) await fetch(`${api}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: headers(service, service) });
  }
});
