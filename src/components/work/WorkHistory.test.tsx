import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { WorkHistory } from './WorkHistory';

const { from, calls } = vi.hoisted(() => ({ from: vi.fn(), calls: [] as unknown[][] }));
vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
const events = [
  { id: 2, actor: 'agent', actor_detail: 'Hermes', event: 'tag.added', summary: 'Tagged “thermo”', changes: { tag: { new: 'thermo' } }, created_at: '2026-10-02T12:00:00Z' },
  { id: 1, actor: 'user', actor_detail: null, event: 'work.updated', summary: 'Changed title from “Draft” to “Final”', changes: { title: { old: 'Draft', new: 'Final' } }, created_at: '2026-10-02T11:00:00Z' },
];
const chain: Record<string, (...args: unknown[]) => unknown> = {};
for (const name of ['select', 'eq', 'order']) chain[name] = (...args: unknown[]) => { calls.push([name, ...args]); return chain; };
chain.range = () => Promise.resolve({ data: events, error: null });
from.mockReturnValue(chain);

it('lists who changed what, with old values, and filters by actor on the server', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><WorkHistory workId="work-1" /></QueryClientProvider>);
  expect(await screen.findByText('Tagged “thermo”')).toBeInTheDocument();
  expect(screen.getByText('Hermes')).toBeInTheDocument();
  expect(within(screen.getByText('Changed title from “Draft” to “Final”').closest('li')!).getByText('You')).toBeInTheDocument();
  expect(screen.getByText('Draft')).toHaveClass('line-through');
  fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
  await waitFor(() => expect(calls).toContainEqual(['eq', 'actor', 'agent']));
  expect(screen.getByRole('button', { name: 'Agents' })).toHaveAttribute('aria-pressed', 'true');
});
