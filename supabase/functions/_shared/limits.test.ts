import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError, jsonBody, withAiLease } from './limits.ts';
Deno.test('body byte limits apply with and without Content-Length', async () => {
  for (const headers of [new Headers({ 'Content-Length': '10' }), new Headers()]) {
    let rejected = false;
    try { await jsonBody(new Request('https://textus.invalid', { method: 'POST', headers, body: '{"a":1234}' }), 5); }
    catch (e) { rejected = e instanceof HttpError && e.status === 413; }
    if (!rejected) throw new Error('oversize body accepted');
  }
  if (await jsonBody(new Request('https://textus.invalid', { method: 'POST', body: 'broken' })) !== null) throw new Error('invalid JSON accepted');
});

Deno.test('interactive GPU lease waits for a background holder; background callers do not', async () => {
  let free = false, calls = 0;
  const admin = { rpc: (name: string) => Promise.resolve({ data: name === 'acquire_ai_lease' ? (calls++, free ? 'holder' : null) : null, error: null }) } as unknown as SupabaseClient;
  setTimeout(() => { free = true; }, 600);
  if (await withAiLease(admin, () => Promise.resolve('ran'), 5_000) !== 'ran' || calls < 2) throw new Error('waiting caller did not acquire the lease');
  free = false;
  let refused = false;
  try { await withAiLease(admin, () => Promise.resolve('ran')); } catch (error) { refused = error instanceof HttpError && error.code === 'ai_busy'; }
  if (!refused) throw new Error('background caller must not wait');
});

Deno.test('a private-GPU worker skips the shared lease', async () => {
  const admin = { rpc: () => { throw new Error('lease RPC called'); } } as unknown as SupabaseClient;
  Deno.env.set('AI_PRIVATE_GPU', 'true');
  try { if (await withAiLease(admin, () => Promise.resolve('ran')) !== 'ran') throw new Error('action did not run'); }
  finally { Deno.env.delete('AI_PRIVATE_GPU'); }
});
