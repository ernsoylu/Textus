// Keep a margin for database finalization inside the reference runtime's 60 s deadline.
export const INVOCATION_MS = 50_000;
// job-worker may run longer only where the Edge router grants it more wall-clock time (README
// "Background worker limits"). Unset keeps the default; the cap keeps its lease under claim_jobs' 2 min.
export const JOB_WORKER_MS = Math.min(100_000, Math.max(INVOCATION_MS, Number(Deno.env.get('JOB_WORKER_BUDGET_MS')) || 0));
export function deadline(ms = INVOCATION_MS) { return AbortSignal.timeout(ms); }
export async function checked<T>(result: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await result;
  if (error) throw error;
  return data;
}

import { HttpError } from './http.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
const signals = new AsyncLocalStorage<AbortSignal>();
// Runs fn with a deadline that boundedFetch honours; withBudget is the HTTP form.
export function withDeadline<T>(ms: number, fn: () => Promise<T>) { return signals.run(deadline(ms), fn); }
export function withBudget<T extends unknown[]>(handler: (...args: T) => Promise<Response>, ms = INVOCATION_MS) {
  return (...args: T) => withDeadline(ms, async () => {
    try { return await handler(...args); }
    catch (error) {
      const code = error instanceof HttpError ? error.code : 'request_failed';
      const status = error instanceof HttpError ? error.status : 500;
      return Response.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '30' } : {}) } });
    }
  });
}
export function boundedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const signal = signals.getStore() ?? deadline();
  return globalThis.fetch(input, { ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal });
}
