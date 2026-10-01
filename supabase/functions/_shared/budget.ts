// Keep a margin for database finalization inside the reference runtime's 60 s deadline.
export const INVOCATION_MS = 50_000;
export function deadline() { return AbortSignal.timeout(INVOCATION_MS); }
export async function checked<T>(result: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await result;
  if (error) throw error;
  return data;
}

import { HttpError } from './http.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
const signals = new AsyncLocalStorage<AbortSignal>();
export function withBudget<T extends unknown[]>(handler: (...args: T) => Promise<Response>) {
  return (...args: T) => signals.run(deadline(), async () => {
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
