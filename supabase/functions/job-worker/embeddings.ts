import type { SupabaseClient } from '@supabase/supabase-js';
import { checked } from '../_shared/budget.ts';
import { embeddingModel, embedText } from '../_shared/ollama.ts';
import { withAiLease } from '../_shared/limits.ts';
export async function embedPassages(admin: SupabaseClient, job: { id: string; user_id: string | null; claim_generation: number; payload: Record<string, unknown> }) {
  const asset = await checked(admin.from('assets').select('id,metadata').eq('id', job.payload.asset_id).eq('user_id', job.user_id).is('deleting_at', null).maybeSingle());
  if (!asset || asset.metadata?.passage_index?.version !== job.payload.index_version || asset.metadata?.passage_index?.status === 'cancelled') return { skipped: true };
  return await withAiLease(admin, async () => {
    const model = await embeddingModel();
    if (model.digest !== job.payload.digest) return { skipped: true, reason: 'Embedding model changed; a new version will be scheduled.' };
    const passages = await checked(admin.from('asset_passages').select('id,content').eq('asset_id', asset.id).eq('user_id', job.user_id).eq('index_version', job.payload.index_version).or(`embedding_digest.is.null,embedding_digest.neq.${model.digest}`).order('id').limit(4)) ?? [];
    if (!passages.length) return { skipped: true };
    // Four small passages fit the invocation/GPU budget. Long Unicode passages are processed alone.
    const batch = new TextEncoder().encode(passages.map((p) => p.content).join('')).length > 8000 ? passages.slice(0, 1) : passages;
    const vectors = await embedText(model, batch.map((p) => p.content));
    const committed = await checked(admin.rpc('commit_embedding_batch', { p_job: job.id, p_generation: job.claim_generation, p_vectors: batch.map((p, i) => ({ id: p.id, embedding: JSON.stringify(vectors[i]) })) }));
    return { checkpointed: true, committed };
  });
}
