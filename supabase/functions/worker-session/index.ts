// Edge Function: worker-session (§8.9). A remote job worker registered in Settings → Workers
// exchanges its tw_ token for a 10-minute service-role JWT (renewed by the worker before expiry)
// and the public anon key its gateway requests need. Revoking the worker deletes its row, so the
// next renewal fails and claim_jobs() stops handing it jobs at once. Deployed with --no-verify-jwt:
// the token is not a JWT.
import { withSupabase, type SupabaseContext } from '@supabase/server';
import { hashAgentToken, signJwt } from '../_shared/agentAuth.ts';
import { checked, withBudget } from '../_shared/budget.ts';
import { HttpError } from '../_shared/http.ts';

const SESSION_SECONDS = 600;

export default {
  fetch: withSupabase({ auth: 'none' }, withBudget(async (req: Request, ctx: SupabaseContext) => {
    if (req.method !== 'POST') throw new HttpError('method_not_allowed', 405);
    const token = /^Bearer (tw_[0-9a-f]{64})$/.exec(req.headers.get('Authorization') ?? '')?.[1];
    if (!token) throw new HttpError('invalid_worker_token', 401);
    const worker = await checked(ctx.supabaseAdmin.from('workers').update({ last_seen_at: new Date().toISOString() })
      .eq('token_hash', await hashAgentToken(token)).select('id').maybeSingle()) as { id: string } | null;
    if (!worker) throw new HttpError('invalid_worker_token', 401);
    const jwt = await signJwt({ role: 'service_role', textus_worker: worker.id }, `${SESSION_SECONDS}s`);
    return Response.json({ worker_id: worker.id, jwt, anon_key: Deno.env.get('SUPABASE_ANON_KEY'), expires_in: SESSION_SECONDS },
      { headers: { 'Cache-Control': 'no-store' } });
  })),
};
