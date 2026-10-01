import { webcrypto } from 'node:crypto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentTab } from './AgentTab';
const { insert } = vi.hoisted(() => ({ insert: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'owner' } } }) }));
vi.mock('@/lib/functions', () => ({ aiStatus: vi.fn().mockResolvedValue({ agentsEnabled: true }) }));
vi.mock('@/lib/supabase', () => ({ supabaseUrl: 'https://api.example', supabase: { from: () => {
  const chain = { select: () => chain, order: () => chain, limit: () => Promise.resolve({ data: [], error: null }), insert };
  return chain;
} } }));
afterEach(() => vi.unstubAllGlobals());
it('stores only a hash and prefix, then shows and dismisses the secret once', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><AgentTab /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Create read token' }));
  const token = (await screen.findByLabelText('New agent token') as HTMLInputElement).value;
  expect(token).toMatch(/^tx_[0-9a-f]{64}$/);
  await waitFor(() => expect(insert).toHaveBeenCalledTimes(1));
  const saved = insert.mock.calls[0][0];
  expect(saved.token_hash).toMatch(/^[0-9a-f]{64}$/); expect(saved.token_prefix).toBe(token.slice(0, 9)); expect(saved.scope).toBe('read');
  expect(JSON.stringify(saved)).not.toContain(token);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss token' }));
  expect(screen.queryByLabelText('New agent token')).not.toBeInTheDocument();
  view.unmount(); client.clear();
});
