import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { AiQueueControl } from './AiQueueControl';

const { maybeSingle, upsert } = vi.hoisted(() => ({ maybeSingle: vi.fn(), upsert: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ maybeSingle }), upsert }) } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'owner' } } }) }));

it('pauses a running AI queue and starts it again', async () => {
  maybeSingle.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValue({ data: { ai_queue_paused: true }, error: null });
  upsert.mockResolvedValue({ error: null });
  render(<QueryClientProvider client={new QueryClient()}><AiQueueControl /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Pause AI queue' }));
  await waitFor(() => expect(upsert).toHaveBeenCalledWith({ user_id: 'owner', ai_queue_paused: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Start AI queue' }));
  await waitFor(() => expect(upsert).toHaveBeenLastCalledWith({ user_id: 'owner', ai_queue_paused: false }));
  expect(screen.getByRole('status')).toHaveTextContent('AI queue paused');
});
