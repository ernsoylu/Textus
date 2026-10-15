import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadIntent } from './functions';

vi.mock('./supabase', () => ({
  supabaseUrl: 'https://textus.invalid',
  supabase: { auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'token' } } }) } },
}));

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const intent = { uploadId: 'u', recordId: 'r', filename: 'a.epub', size: 1 };

describe('callFunction', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('waits for the next rate-limit window and retries', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply(429, { error: 'rate_limited' }))
      .mockResolvedValueOnce(reply(200, { path: 'p', token: 't' }));
    vi.stubGlobal('fetch', fetch);
    const result = uploadIntent(intent);
    await vi.advanceTimersByTimeAsync(61_000);
    await expect(result).resolves.toEqual({ path: 'p', token: 't' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up with a friendly message after repeated rate limits', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(reply(429, { error: 'rate_limited' }))));
    const result = uploadIntent(intent);
    const assertion = expect(result).rejects.toThrow('Too many requests');
    await vi.advanceTimersByTimeAsync(11 * 61_000);
    await assertion;
  });

  it('does not retry other errors', async () => {
    const fetch = vi.fn(() => Promise.resolve(reply(429, { error: 'ai_busy' })));
    vi.stubGlobal('fetch', fetch);
    await expect(uploadIntent(intent)).rejects.toThrow('ai_busy');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
