import type { SupabaseClient } from '@supabase/supabase-js';
import { checked } from './budget.ts';
import { HttpError } from './http.ts';
export { HttpError } from './http.ts';
export async function jsonBody(req: Request, maxBytes = 32_000): Promise<unknown> {
  if (Number(req.headers.get('content-length') ?? 0) > maxBytes) throw new HttpError('request_too_large', 413);
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); throw new HttpError('request_too_large', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}
export async function rateLimit(admin: SupabaseClient, key: string, limit = 30, period = 60) {
  if (!await checked(admin.rpc('check_request_limit', { p_key: key, p_limit: limit, p_period: period }))) throw new HttpError('rate_limited', 429);
}
// Interactive callers wait briefly for the shared GPU lease; background jobs pass 0 and defer instead.
export async function withAiLease<T>(admin: SupabaseClient, action: () => Promise<T>, waitMs = 0): Promise<T> {
  const until = Date.now() + waitMs;
  let holder = await checked(admin.rpc('acquire_ai_lease'));
  while (!holder && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    holder = await checked(admin.rpc('acquire_ai_lease'));
  }
  if (!holder) throw new HttpError('ai_busy', 429);
  try { return await action(); }
  finally { await checked(admin.rpc('release_ai_lease', { p_holder: holder })); }
}
