import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { PassageIndex } from './PassageIndex';
const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, from } }));
beforeEach(() => {
  rpc.mockReset(); from.mockReset();
  rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'passage_coverage' ? { indexedAssets: 1, eligibleAssets: 2, partial: true } : name === 'search_passages' ? [] : 1, error: null }));
  const rows = [{ id: 'asset-1', metadata: { filename: 'Book.pdf', passage_index: { status: 'failed', done: 6, total: 10, passages: 6 } } }];
  const chain = { select: () => chain, in: () => chain, order: () => chain, limit: () => Promise.resolve({ data: rows, error: null }) };
  from.mockReturnValue(chain);
});
it('shows partial coverage and sends explicit retry/search requests', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter><PassageIndex /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText(/1 of 2 PDF\/EPUB files fully indexed/)).toHaveTextContent('Coverage is partial');
  expect(await screen.findByText(/6\/10 pages or sections/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('control_passage_index', { p_action: 'retry', p_asset: 'asset-1' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search indexed passages' }), { target: { value: 'solar' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('No supporting passage found in indexed text.')).toBeInTheDocument();
  expect(rpc).toHaveBeenCalledWith('search_passages', { p_query: 'solar', p_limit: 20 });
  view.unmount(); client.clear();
});
