import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { AgentApprovals } from './AgentApprovals';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, from: () => {
  const chain = { select: () => chain, in: () => chain, order: () => chain, limit: () => Promise.resolve({ error: null, data: [{ id: 'exact-action', tool: 'tag_work', arguments: { workId: 'work', tagId: 'tag' }, preview: { workTitle: 'Owned work', targetName: 'Research' }, status: 'pending', expires_at: '2100-01-01', token_id: 'writer', agent_tokens: { name: 'Hermes' } }] }) };
  return chain;
} } }));
it('shows the target names and approves only the exact server action', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><AgentApprovals /></QueryClientProvider>);
  expect(await screen.findByText(/Apply tag “Research” for all records of “Owned work”/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('review_agent_action', { p_action: 'exact-action', p_approve: true }));
  view.unmount(); client.clear();
});
