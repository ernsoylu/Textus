import { withSupabase, type SupabaseContext } from '@supabase/server';
import { z } from 'zod';
import { aiConfig, localModels, ollama } from '../_shared/ollama.ts';
import { checked, withBudget } from '../_shared/budget.ts';
import { HttpError, jsonBody, rateLimit } from '../_shared/limits.ts';
const RequestSchema = z.object({ action: z.enum(['status', 'models']) }).strict();
export default {
  fetch: withSupabase({ auth: 'user' }, withBudget(async (req: Request, ctx: SupabaseContext) => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const input = RequestSchema.safeParse(await jsonBody(req));
    if (!input.success) throw new HttpError('invalid_request');
    await rateLimit(ctx.supabaseAdmin, `ai:${ctx.userClaims!.id}`);
    const config = aiConfig();
    if (input.data.action === 'models') {
      return Response.json({ models: (await localModels()).map((m) => ({ name: m.name, family: m.details?.family, parameterSize: m.details?.parameter_size, quantization: m.details?.quantization_level, sizeBytes: m.size })) });
    }
    const setting = await checked(ctx.supabase.from('ai_settings').select('generation_model').eq('user_id', ctx.userClaims!.id).maybeSingle());
    let reachable = false;
    if (config.enabled) { try { await ollama('/api/version', undefined, 3000); reachable = true; } catch { /* status must work during an outage */ } }
    return Response.json({ enabled: config.enabled, reachable, defaultModel: config.defaultModel, embedModel: config.embedModel, selectedModel: setting?.generation_model ?? config.defaultModel });
  })),
};
