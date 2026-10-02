import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { PassageSearch } from './PassageSearch';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

it('searches indexed passages and reports an empty result honestly', async () => {
  rpc.mockResolvedValue({ data: [], error: null });
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><PassageSearch /></MemoryRouter></QueryClientProvider>);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search indexed passages' }), { target: { value: 'solar' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('No supporting passage found in indexed text.')).toBeInTheDocument();
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('search_passages', { p_query: 'solar', p_limit: 20 }));
});
