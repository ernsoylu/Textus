// Remote job worker (§7.5): runs job-worker's handlers in a container on another host, in parallel
// with the Edge worker. Settings → Workers registers it and prints TEXTUS_URL and TEXTUS_WORKER_TOKEN;
// worker-session turns the token into a 10-minute textus_worker JWT, renewed before it expires.
//   WORKER_CONCURRENCY  parallel jobs (default 2, max 16)
//   WORKER_JOB_TYPES    comma-separated job types; default: all, minus AI jobs unless AI_ENABLED/OLLAMA_URL are set
//   JOB_WORKER_MEMORY_MB / JOB_WORKER_BUDGET_MS and provider/Ollama variables work as for the Edge worker.
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AI_JOB_TYPES, processJobs } from './index.ts';
import { aiConfig } from '../_shared/ollama.ts';
import { boundedFetch, JOB_WORKER_MS, withDeadline } from '../_shared/budget.ts';

const BASE_JOB_TYPES = ['extract_text', 'index_passages', 'fetch_metadata', 'process_cover'];
const IDLE_MS = 5_000;
const ERROR_MS = 30_000;

const url = Deno.env.get('TEXTUS_URL') ?? '';
const token = Deno.env.get('TEXTUS_WORKER_TOKEN') ?? '';
if (!/^https?:\/\//.test(url) || !/^tw_[0-9a-f]{64}$/.test(token)) {
  console.error('Set TEXTUS_URL and TEXTUS_WORKER_TOKEN from Settings → Workers.');
  Deno.exit(1);
}
const concurrency = Math.min(16, Math.max(1, Number(Deno.env.get('WORKER_CONCURRENCY')) || 2));
const types = Deno.env.get('WORKER_JOB_TYPES')?.split(',').map((v) => v.trim()).filter(Boolean)
  ?? [...BASE_JOB_TYPES, ...(aiConfig().enabled ? AI_JOB_TYPES : [])];

const Session = z.object({ worker_id: z.string().uuid(), jwt: z.string().min(1), anon_key: z.string().min(1), expires_in: z.number().positive() });
let session: (z.infer<typeof Session> & { renewAt: number }) | undefined;

async function currentSession() {
  if (session && Date.now() < session.renewAt) return session;
  const response = await fetch(new URL('/functions/v1/worker-session', url), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(response.status === 401 ? 'worker token was revoked or is invalid' : `worker-session HTTP ${response.status}`);
  const body = Session.parse(await response.json());
  // Renew well before expiry so no job (≤ JOB_WORKER_MS) outlives its JWT.
  session = { ...body, renewAt: Date.now() + body.expires_in * 1000 - JOB_WORKER_MS - 60_000 };
  return session;
}

function client(s: z.infer<typeof Session>, jobType?: string) {
  return createClient(url, s.anon_key, {
    global: { headers: { Authorization: `Bearer ${s.jwt}`, ...(jobType ? { 'x-textus-actor': `job:${jobType}` } : {}) }, fetch: boundedFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function loop() {
  for (;;) {
    try {
      const s = await currentSession();
      const outcome = await withDeadline(JOB_WORKER_MS, () => processJobs(client(s), (jobType) => client(s, jobType), { types, worker: s.worker_id }));
      for (const result of outcome.results) console.info(JSON.stringify({ event: 'job', ...result }));
      if (!outcome.claimed) await new Promise((r) => setTimeout(r, IDLE_MS));
    } catch (error) {
      console.error(JSON.stringify({ event: 'worker_error', message: error instanceof Error ? error.message : 'unknown' }));
      await new Promise((r) => setTimeout(r, ERROR_MS));
    }
  }
}

console.info(JSON.stringify({ event: 'worker_start', concurrency, types }));
await Promise.all(Array.from({ length: concurrency }, loop));
