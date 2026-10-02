import type { SupabaseClient } from '@supabase/supabase-js';
import { checked, JOB_WORKER_MS } from '../_shared/budget.ts';
import { EMBED_BATCH, embeddingModel, embedText } from '../_shared/ollama.ts';
import { HttpError, withAiLease } from '../_shared/limits.ts';
const CHECKPOINT = 256; // commit_embedding_batch's per-checkpoint limit
// The next Ollama call: up to EMBED_BATCH.count passages within EMBED_BATCH.bytes, always at least one.
export function nextBatch<T extends { content: string }>(passages: T[], at: number): T[] {
  const batch: T[] = [];
  let bytes = 0;
  for (const passage of passages.slice(at, at + EMBED_BATCH.count)) {
    const size = new TextEncoder().encode(passage.content).length;
    if (batch.length && bytes + size > EMBED_BATCH.bytes) break;
    batch.push(passage); bytes += size;
  }
  return batch;
}
export async function embedPassages(admin: SupabaseClient, job: { id: string; user_id: string | null; claim_generation: number; payload: Record<string, unknown> }) {
  const asset = await checked(admin.from('assets').select('id,metadata').eq('id', job.payload.asset_id).eq('user_id', job.user_id).is('deleting_at', null).maybeSingle());
  if (!asset || asset.metadata?.passage_index?.version !== job.payload.index_version || asset.metadata?.passage_index?.status === 'cancelled') return { skipped: true };
  const model = await embeddingModel();
  if (model.digest !== job.payload.digest) return { skipped: true, reason: 'Embedding model changed; a new version will be scheduled.' };
  const passages = await checked(admin.from('asset_passages').select('id,content').eq('asset_id', asset.id).eq('user_id', job.user_id).eq('index_version', job.payload.index_version).or(`embedding_digest.is.null,embedding_digest.neq.${model.digest}`).order('id').limit(CHECKPOINT)) ?? [];
  if (!passages.length) return { skipped: true };
  // Batched Ollama calls (nextBatch); one checkpoint commits every call that fits in half the run budget.
  const vectors: { id: number; embedding: string }[] = [];
  for (let at = 0, started = Date.now(); at < passages.length && Date.now() - started < JOB_WORKER_MS / 2;) {
    const batch = nextBatch(passages, at);
    // The GPU lease is held per Ollama call, so interactive searches and overlapping runs take turns; waiting
    // about one batch for it beats deferring the whole book.
    let embedded: number[][];
    try { embedded = await withAiLease(admin, () => embedText(model, batch.map((p) => p.content)), 5_000); } catch (error) {
      if (error instanceof HttpError && error.code === 'ai_busy' && vectors.length) break;
      throw error;
    }
    vectors.push(...batch.map((p, i) => ({ id: p.id, embedding: JSON.stringify(embedded[i]) })));
    at += batch.length;
  }
  const committed = await checked(admin.rpc('commit_embedding_batch', { p_job: job.id, p_generation: job.claim_generation, p_vectors: vectors }));
  return { checkpointed: true, committed };
}
