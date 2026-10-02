import type { SupabaseClient } from '@supabase/supabase-js';
import { checked, JOB_WORKER_MS } from '../_shared/budget.ts';
import { embeddingModel, embedText } from '../_shared/ollama.ts';
import { HttpError, withAiLease } from '../_shared/limits.ts';
const CHECKPOINT = 64; // commit_embedding_batch's per-checkpoint limit
export async function embedPassages(admin: SupabaseClient, job: { id: string; user_id: string | null; claim_generation: number; payload: Record<string, unknown> }) {
  const asset = await checked(admin.from('assets').select('id,metadata').eq('id', job.payload.asset_id).eq('user_id', job.user_id).is('deleting_at', null).maybeSingle());
  if (!asset || asset.metadata?.passage_index?.version !== job.payload.index_version || asset.metadata?.passage_index?.status === 'cancelled') return { skipped: true };
  const model = await embeddingModel();
  if (model.digest !== job.payload.digest) return { skipped: true, reason: 'Embedding model changed; a new version will be scheduled.' };
  const passages = await checked(admin.from('asset_passages').select('id,content').eq('asset_id', asset.id).eq('user_id', job.user_id).eq('index_version', job.payload.index_version).or(`embedding_digest.is.null,embedding_digest.neq.${model.digest}`).order('id').limit(CHECKPOINT)) ?? [];
  if (!passages.length) return { skipped: true };
  // Ollama calls take four small passages (long Unicode passages go alone); one checkpoint commits
  // every call that fits in half the run budget.
  const vectors: { id: number; embedding: string }[] = [];
  for (let at = 0, started = Date.now(); at < passages.length && Date.now() - started < JOB_WORKER_MS / 2;) {
    const group = passages.slice(at, at + 4);
    const batch = new TextEncoder().encode(group.map((p) => p.content).join('')).length > 8000 ? group.slice(0, 1) : group;
    // The GPU lease is held per Ollama call, so interactive source searches can interleave with a long run.
    let embedded: number[][];
    try { embedded = await withAiLease(admin, () => embedText(model, batch.map((p) => p.content))); } catch (error) {
      if (error instanceof HttpError && error.code === 'ai_busy' && vectors.length) break;
      throw error;
    }
    vectors.push(...batch.map((p, i) => ({ id: p.id, embedding: JSON.stringify(embedded[i]) })));
    at += batch.length;
  }
  const committed = await checked(admin.rpc('commit_embedding_batch', { p_job: job.id, p_generation: job.claim_generation, p_vectors: vectors }));
  return { checkpointed: true, committed };
}
