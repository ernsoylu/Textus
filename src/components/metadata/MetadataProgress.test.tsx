import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AutoMetadataImport } from './AutoMetadataImport';
import { MetadataLookup } from './MetadataLookup';
import { importMetadata } from '@/lib/autoMetadataImport';
import { metadataLookup } from '@/lib/functions';

vi.mock('@/lib/autoMetadataImport', () => ({ importMetadata: vi.fn() }));
vi.mock('@/lib/functions', () => ({ metadataLookup: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const work = { id: 'work', title: 'Book', subtitle: null, abstract: null, language: null, work_type: 'book', metadata: {} };
const record = { id: 'record', title: null, publisher: null, publication_date: null, publication_date_precision: null, volume: null, issue_number: null, pages: null, metadata: {}, metadata_fetched_at: null, record_contributors: [], record_assets: [] };
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/library/work']}><Routes><Route path="/library/work" element={children} /><Route path="/library/:id" element={<p>Existing book page</p>} /></Routes></MemoryRouter></QueryClientProvider>;

describe('metadata progress', () => {
  it('shows the automatic import stage without a percentage, then removes the bar', async () => {
    let finish = () => {};
    vi.mocked(importMetadata).mockImplementation(async (_work, _record, onMessage) => {
      onMessage('Found ISBN 9787710094420; looking up details…');
      await new Promise<void>((resolve) => { finish = resolve; });
      onMessage('Added metadata from internet_archive.');
      return undefined;
    });
    render(<AutoMetadataImport work={work} record={record} enabled />, { wrapper });
    expect(await screen.findByRole('progressbar')).not.toHaveAttribute('value');
    expect(screen.getByRole('status')).toHaveTextContent('Found ISBN 9787710094420');
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Added metadata');
  });

  it('opens the existing book when the upload folded into it', async () => {
    vi.mocked(importMetadata).mockResolvedValue({ mergedInto: 'existing' });
    render(<AutoMetadataImport work={work} record={record} enabled />, { wrapper });
    expect(await screen.findByText('Existing book page')).toBeInTheDocument();
  });

  it('shows the chosen identifier during a manual lookup and stops on a miss', async () => {
    let finish = () => {};
    vi.mocked(metadataLookup).mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ status: 'not_found', identifier: '10.1000/example', searchedProviders: ['crossref'] }); }));
    render(<MetadataLookup work={work} record={record} />, { wrapper });
    fireEvent.change(screen.getByLabelText('Identifier scheme'), { target: { value: 'doi' } });
    fireEvent.change(screen.getByPlaceholderText('Identifier'), { target: { value: '10.1000/example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByRole('progressbar', { name: 'Searching DOI 10.1000/example…' })).not.toHaveAttribute('value');
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    expect(screen.getByText('No metadata found in crossref.')).toBeInTheDocument();
  });
});
