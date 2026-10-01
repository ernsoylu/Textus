import { z } from 'zod';
import { boundedFetch } from './budget.ts';
import { readCapped } from './http.ts';
import { HttpError } from './limits.ts';

export function aiConfig() {
  const url = Deno.env.get('OLLAMA_URL') ?? '';
  const defaultModel = Deno.env.get('OLLAMA_DEFAULT_MODEL') ?? 'qwen3.5:4b';
  const embedModel = Deno.env.get('OLLAMA_EMBED_MODEL') ?? 'nomic-embed-text:latest';
  const allowedModels = (Deno.env.get('OLLAMA_ALLOWED_MODELS') ?? defaultModel).split(',').map((v) => v.trim()).filter(Boolean);
  const contextTokens = Math.min(8192, Math.max(2048, Number(Deno.env.get('OLLAMA_CONTEXT_TOKENS')) || 4096));
  return { enabled: Deno.env.get('AI_ENABLED') === 'true' && !!url, url, defaultModel, embedModel, allowedModels, contextTokens };
}
const ModelSchema = z.object({
  name: z.string().max(200), digest: z.string().max(200), size: z.number().nonnegative(),
  remote_host: z.string().optional(), remote_model: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  details: z.object({ family: z.string().optional(), parameter_size: z.string().optional(), quantization_level: z.string().optional(), context_length: z.number().optional() }).optional(),
});
export type LocalModel = z.infer<typeof ModelSchema>;
export function isAllowedModel(model: LocalModel, allowed: string[]) {
  return allowed.includes(model.name) && !model.remote_host && !model.remote_model && !/:cloud$/i.test(model.name) && (!model.capabilities || model.capabilities.includes('completion'));
}
export async function ollama(path: '/api/version' | '/api/tags' | '/api/generate' | '/api/embed', body?: unknown, timeoutMs = 40_000): Promise<unknown> {
  const config = aiConfig();
  if (!config.enabled) throw new HttpError('ai_disabled', 503);
  let base: URL;
  try { base = new URL(config.url); } catch { throw new HttpError('ai_misconfigured', 503); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new HttpError('ai_misconfigured', 503);
  try {
    const response = await boundedFetch(new URL(path, base), {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', ...(Deno.env.get('OLLAMA_API_KEY') ? { Authorization: `Bearer ${Deno.env.get('OLLAMA_API_KEY')}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new HttpError(response.status === 404 ? 'model_missing' : 'ai_unreachable', 503);
    return JSON.parse(await readCapped(response));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(e instanceof DOMException && e.name === 'TimeoutError' ? 'timeout' : 'ai_unreachable', 503);
  }
}
export async function localModels(): Promise<LocalModel[]> {
  const data = z.object({ models: z.array(ModelSchema).max(200) }).parse(await ollama('/api/tags', undefined, 3000));
  return data.models.filter((m) => isAllowedModel(m, aiConfig().allowedModels));
}
export async function selectedModel(name?: string | null) {
  const selected = name ?? aiConfig().defaultModel;
  const model = (await localModels()).find((m) => m.name === selected);
  if (!model) throw new HttpError('model_missing', 503);
  return model;
}
export async function generateJson(model: LocalModel, prompt: string, schema: unknown) {
  const config = aiConfig();
  // Conservative UTF-8 budget: one token per byte, reserving instructions and output.
  if (new TextEncoder().encode(prompt).length > config.contextTokens - 768) throw new HttpError('context_budget_exceeded', 400);
  const output = z.object({ response: z.string().max(100_000), done: z.literal(true) }).parse(await ollama('/api/generate', {
    model: model.name, prompt, format: schema, stream: false, think: false, keep_alive: '5m',
    options: { num_ctx: config.contextTokens, num_predict: 512, temperature: 0 },
  }));
  try { return JSON.parse(output.response); } catch { throw new HttpError('invalid_model_output', 502); }
}
