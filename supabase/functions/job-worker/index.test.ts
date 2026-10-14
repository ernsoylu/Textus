import { processJobs } from './index.ts';

Deno.test('file extraction batches metadata jobs for every linked record and preserves lease fencing', async () => {
  const asset = { id: 'asset', user_id: 'owner', file_format: 'pdf', file_size: 30_000_000 };
  const job = { id: 'job', job_type: 'extract_text', user_id: 'owner', claim_generation: 7, payload: { asset_id: asset.id, filename: 'ISBN9780261103252.pdf' } };
  const writes: unknown[] = [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      let data: unknown = true;
      if (name === 'claim_jobs') data = [job];
      if (name === 'merge_extraction_metadata') data = null;
      return Promise.resolve({ data, error: null });
    },
    from: (table: string) => {
      const data = table === 'assets' ? asset : [{ record_id: 'record-1' }, { record_id: 'record-2' }];
      const result = Promise.resolve({ data, error: null });
      const query = {
        select: () => query, eq: () => query, is: () => query, single: () => result,
        then: result.then.bind(result),
        upsert: (rows: unknown, options: unknown) => { writes.push({ rows, options }); return result; },
      };
      return query;
    },
  };
  const result = await processJobs(admin, () => admin);
  const rows = ['record-1', 'record-2'].map((record_id) => ({
    user_id: 'owner', job_type: 'fetch_metadata', payload: { record_id, scheme: 'isbn', value: '9780261103252' },
    idempotency_key: `fetch_metadata:${record_id}:isbn:9780261103252`,
  }));
  if (JSON.stringify(writes) !== JSON.stringify([{ rows, options: { onConflict: 'idempotency_key', ignoreDuplicates: true } }])) throw new Error('Metadata jobs were not batched correctly');
  if (calls[0].args.p_limit !== 1 || calls.at(-1)?.args.p_generation !== 7 || result.results[0].status !== 'succeeded') throw new Error('Job claim or completion fencing changed');
});
