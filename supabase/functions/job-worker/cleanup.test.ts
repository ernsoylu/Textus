import { runCleanup } from './cleanup.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

Deno.test('cleanup finalizes only after object deletion; failed storage leaves a durable claim', async () => {
  const calls: string[] = [];
  let fail = true;
  const admin = {
    rpc: (name: string) => {
      calls.push(name);
      return Promise.resolve({ data: name === 'claim_storage_cleanup' ? [{ bucket: 'documents', path: 'u/a.pdf' }] : null, error: null });
    },
    storage: { from: () => ({ remove: () => { calls.push('remove'); return Promise.resolve({ data: [], error: fail ? new Error('storage unavailable') : null }); } }) },
  } as unknown as SupabaseClient;
  try { await runCleanup(admin); } catch { /* expected */ }
  if (calls.includes('finish_storage_deletion')) throw new Error('removed database state before bytes');
  fail = false;
  const result = await runCleanup(admin);
  if (result.objectsRemoved !== 1 || calls.at(-1) !== 'finish_storage_deletion') throw new Error('claim not finalized after retry');
});
