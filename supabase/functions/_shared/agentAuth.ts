import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SignJWT, importJWK, type JWTPayload } from 'jose';
import { readCapped } from './http.ts';
import { boundedFetch, checked } from './budget.ts';
import { HttpError } from './http.ts';
export interface AgentPrincipal { token_id: string; user_id: string; scope: 'read' | 'read_write' }
export function checkMcpOrigin(req: Request) {
  const origin = req.headers.get('Origin');
  if (!origin) return;
  const allowed = (Deno.env.get('MCP_ALLOWED_ORIGINS') ?? Deno.env.get('TEXTUS_SITE_URL') ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new HttpError('invalid_origin', 403); }
  if (parsed.origin !== origin || !allowed.includes(origin)) throw new HttpError('invalid_origin', 403);
}
export async function hashAgentToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
export async function authenticateAgent(admin: SupabaseClient, req: Request): Promise<AgentPrincipal> {
  return await agentPrincipal(admin, /^Bearer (tx_[0-9a-f]{64})$/i.exec(req.headers.get('Authorization') ?? '')?.[1]);
}
export async function agentPrincipal(admin: SupabaseClient, token: string | undefined): Promise<AgentPrincipal> {
  if (!token || !/^tx_[0-9a-f]{64}$/i.test(token)) throw new HttpError('invalid_agent_token', 401);
  const data = await checked(admin.rpc('use_agent_token', { p_hash: await hashAgentToken(token) }));
  const principal = data?.[0];
  if (!principal || !['read', 'read_write'].includes(principal.scope)) throw new HttpError('invalid_agent_token', 401);
  return principal;
}
export function requireAgentScope(principal: AgentPrincipal, scope: 'read' | 'read_write') {
  if (scope === 'read_write' && principal.scope !== 'read_write') throw new HttpError('insufficient_scope', 403);
}
// Signs a short-lived JWT with the instance's key: MCP_SIGNING_JWK when set, else JWT_SECRET.
export async function signJwt(claims: JWTPayload, ttl: string) {
  const jwk = Deno.env.get('MCP_SIGNING_JWK');
  const secret = Deno.env.get('JWT_SECRET');
  let key, header: { alg: string; kid?: string };
  if (jwk) {
    const data = JSON.parse(jwk);
    if (!['ES256', 'EdDSA'].includes(data.alg) || !data.d) throw new HttpError('mcp_signing_misconfigured', 503);
    key = await importJWK(data, data.alg); header = { alg: data.alg, kid: data.kid };
  } else {
    if (!secret || secret.length < 32) throw new HttpError('mcp_signing_misconfigured', 503);
    key = new TextEncoder().encode(secret); header = { alg: 'HS256' };
  }
  return await new SignJWT(claims).setProtectedHeader(header).setIssuedAt().setExpirationTime(ttl).sign(key);
}
export async function agentClient(principal: AgentPrincipal) {
  const jwt = await signJwt({ role: 'authenticated', textus_agent: true, textus_scope: principal.scope, textus_token_id: principal.token_id, sub: principal.user_id, aud: 'authenticated' }, '5m');
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` }, fetch: async (input, init) => {
    const response = await boundedFetch(input, init);
    const body = await readCapped(response);
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
