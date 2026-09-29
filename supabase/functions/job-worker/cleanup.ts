// `cleanup` job (§8.3, §15 #9). Three sweeps, each capped so one run stays well inside the Edge time
// limit; the job is enqueued daily, so a backlog drains over a few days.
//   1. staging/ objects older than 24 h (interrupted uploads)
//   2. assets no record links to any more, older than 24 h (row + object)
//   3. storage folders of users that no longer exist (ON DELETE CASCADE removes rows, not objects)
const DAY_MS = 86_400_000;
const MAX_REMOVALS = 500;
const MAX_FOLDERS = 50;
const BUCKETS = ['documents', 'covers', 'staging'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Entry { name: string; id: string | null; created_at?: string | null }

// deno-lint-ignore no-explicit-any
type Admin = any;

async function list(admin: Admin, bucket: string, prefix: string): Promise<Entry[]> {
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw error;
  return data ?? [];
}

// Every object under `prefix`, walking folders (folders have a null id). Stops at `limit` objects.
export async function walk(admin: Admin, bucket: string, prefix: string, limit = MAX_REMOVALS): Promise<{ path: string; createdAt: number }[]> {
  const found: { path: string; createdAt: number }[] = [];
  const queue = [prefix];
  while (queue.length && found.length < limit) {
    const dir = queue.shift()!;
    for (const entry of await list(admin, bucket, dir)) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.id === null) queue.push(path);
      else found.push({ path, createdAt: Date.parse(entry.created_at ?? '') || 0 });
    }
  }
  return found.slice(0, limit);
}

async function remove(admin: Admin, bucket: string, paths: string[]): Promise<number> {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) throw error;
  }
  return paths.length;
}

async function sweepStaging(admin: Admin, now: number): Promise<number> {
  const stale = (await walk(admin, 'staging', '')).filter((f) => f.createdAt > 0 && now - f.createdAt > DAY_MS);
  return await remove(admin, 'staging', stale.map((f) => f.path));
}

async function sweepUnreferencedAssets(admin: Admin, now: number): Promise<number> {
  const cutoff = new Date(now - DAY_MS).toISOString();
  const { data, error } = await admin.from('assets').select('id,bucket,storage_path,record_assets(asset_id)').lt('created_at', cutoff).limit(200);
  if (error) throw error;
  const orphans = (data ?? []).filter((a: { record_assets: unknown[] }) => a.record_assets.length === 0);
  const byBucket = new Map<string, string[]>();
  for (const a of orphans) byBucket.set(a.bucket, [...(byBucket.get(a.bucket) ?? []), a.storage_path]);
  for (const [bucket, paths] of byBucket) await remove(admin, bucket, paths);
  if (orphans.length) {
    const { error: deleteError } = await admin.from('assets').delete().in('id', orphans.map((a: { id: string }) => a.id));
    if (deleteError) throw deleteError;
  }
  return orphans.length;
}

async function userExists(admin: Admin, id: string): Promise<boolean> {
  const { data, error } = await admin.auth.admin.getUserById(id);
  if (data?.user) return true;
  // Only a definite "not found" counts as deleted; any other error must not delete anything.
  if (error?.status === 404 || error?.code === 'user_not_found') return false;
  throw error ?? new Error('could not look up user');
}

async function sweepDeletedUsers(admin: Admin): Promise<number> {
  let removed = 0;
  let checked = 0;
  for (const bucket of BUCKETS) {
    for (const folder of await list(admin, bucket, '')) {
      if (folder.id !== null || !UUID.test(folder.name) || checked++ >= MAX_FOLDERS) continue;
      if (await userExists(admin, folder.name)) continue;
      removed += await remove(admin, bucket, (await walk(admin, bucket, folder.name)).map((f) => f.path));
    }
  }
  return removed;
}

export async function runCleanup(admin: Admin, now = Date.now()) {
  return {
    stagingRemoved: await sweepStaging(admin, now),
    assetsRemoved: await sweepUnreferencedAssets(admin, now),
    deletedUserObjectsRemoved: await sweepDeletedUsers(admin),
  };
}
