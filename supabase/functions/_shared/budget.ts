// Keep a margin for database finalization inside the reference runtime's 60 s deadline.
export const INVOCATION_MS = 50_000;
export function deadline() { return AbortSignal.timeout(INVOCATION_MS); }
export async function checked<T>(result: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await result;
  if (error) throw error;
  return data;
}

import { AsyncLocalStorage } from 'node:async_hooks';
const signals = new AsyncLocalStorage<AbortSignal>();
export function withBudget<T extends unknown[], R>(handler: (...args: T) => Promise<R>) {
  return (...args: T) => signals.run(deadline(), () => handler(...args));
}
export function boundedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const signal = signals.getStore() ?? deadline();
  return globalThis.fetch(input, { ...init, signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal });
}
