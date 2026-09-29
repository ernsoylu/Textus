const api = Deno.env.get('SUPABASE_URL') ?? 'http://127.0.0.1:54321';
const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('ANON_KEY') ?? '';
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

    const bytes = new TextEncoder().encode('%PDF-1.4\n% Textus integration fixture\n%%EOF');
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

    const exported = await fetch(`${api}/functions/v1/export`, {
      method: 'POST', headers: headers(accessToken), body: JSON.stringify({ recordIds: [recordId], format: 'bibtex' }),
    });
    const exportBody = await exported.json();
    if (!exported.ok || exportBody.count !== 1 || !exportBody.content.includes(`Phase 7 ${suffix}`)) throw new Error(`citation export failed (${exported.status})`);

    const opds = await fetch(`${api}/functions/v1/opds`, {
      headers: { Authorization: `Basic ${btoa(`${email}:${password}`)}`, apikey: anon },
    });
    const feed = await opds.text();
    if (!opds.ok || !feed.includes('All titles') || !feed.includes('Collections')) throw new Error(`OPDS start feed failed (${opds.status})`);
  } finally {
    if (userId) await fetch(`${api}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: headers(service, service) });
  }
});
