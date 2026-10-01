import { checked } from '../_shared/budget.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

// SQL qualifies candidates before limiting and marks assets as deleting under row locks.
// Every linking path rejects that state. Claims survive storage failures and worker crashes.
export async function runCleanup(admin: SupabaseClient, signal = AbortSignal.timeout(45_000)) {
  await checked(admin.rpc('prune_operational_history'));
  const claims = await checked(admin.rpc('claim_storage_cleanup', { p_limit: 100 })) as { bucket: string; path: string; asset_id: string | null }[];
  let removed = 0;
  for (const claim of claims) {
    signal.throwIfAborted();
    const { error } = await admin.storage.from(claim.bucket).remove([claim.path]);
    if (error) {
      await checked(admin.rpc('retry_storage_deletion', { p_bucket: claim.bucket, p_path: claim.path }));
      continue;
    }
    await checked(admin.rpc('finish_storage_deletion', { p_bucket: claim.bucket, p_path: claim.path }));
    removed++;
  }
  return { objectsRemoved: removed, remaining: claims.length === 100 };
}

// Account deletion already cascades assets; SQL discovers its object paths directly,
// so it cannot be starved by active users/folder ordering or listing pagination.
export async function removeUserObjects(admin: SupabaseClient, _userId: string) {
  return (await runCleanup(admin)).objectsRemoved;
}
