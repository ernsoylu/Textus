import { runCleanup, walk } from './cleanup.ts';

// A fake storage tree: folders have a null id, objects carry created_at.
const tree: Record<string, { name: string; id: string | null; created_at?: string }[]> = {
  '': [{ name: 'u1', id: null }],
  u1: [{ name: 'up1', id: null }, { name: 'a.txt', id: 'x', created_at: '2020-01-01T00:00:00Z' }],
  'u1/up1': [{ name: 'upload', id: 'y', created_at: '2020-01-02T00:00:00Z' }],
};

const GHOST = '00000000-0000-4000-8000-000000000000';
const entries = (bucket: string, prefix: string) => {
  if (bucket === 'staging') return tree[prefix] ?? [];
  return bucket === 'documents' && prefix === '' ? [{ name: GHOST, id: null }] : [];
};

function fakeAdmin(removed: string[]) {
  return {
    storage: {
      from: (bucket: string) => ({
        list: (prefix: string) => Promise.resolve({ data: entries(bucket, prefix), error: null }),
        remove: (paths: string[]) => { removed.push(...paths); return Promise.resolve({ error: null }); },
      }),
    },
    from: () => ({ select: () => ({ lt: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }),
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: null }, error: { status: 500, message: 'boom' } }) } },
  };
}

Deno.test('walk descends into folders and reports created_at', async () => {
  const files = await walk(fakeAdmin([]), 'staging', '');
  const paths = files.map((f) => f.path).sort();
  if (JSON.stringify(paths) !== JSON.stringify(['u1/a.txt', 'u1/up1/upload'])) throw new Error(`unexpected walk: ${paths}`);
  if (!files.every((f) => f.createdAt > 0)) throw new Error('created_at not parsed');
});

Deno.test('cleanup removes stale staging files but never deletes on an unknown user lookup error', async () => {
  const removed: string[] = [];
  let failed = false;
  try {
    await runCleanup(fakeAdmin(removed), Date.parse('2026-01-01T00:00:00Z'));
  } catch {
    failed = true; // getUserById returned a 500, not a 404: must abort, not treat the user as deleted
  }
  if (!failed) throw new Error('an ambiguous user lookup must abort the sweep');
  if (removed.sort().join() !== 'u1/a.txt,u1/up1/upload') throw new Error(`unexpected removals: ${removed}`);
});
