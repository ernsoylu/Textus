import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewWork } from './NewWork';
import { uploadFile } from '@/hooks/useUploadAsset';
import { importMetadata } from '@/lib/autoMetadataImport';

const { navigate, inserted } = vi.hoisted(() => ({ navigate: vi.fn(), inserted: [] as { table: string; data: Record<string, unknown> }[] }));
vi.mock('react-router-dom', async (original) => ({ ...await original<typeof import('react-router-dom')>(), useNavigate: () => navigate }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'user' } } }) }));
vi.mock('@/hooks/useUploadAsset', () => ({ uploadFile: vi.fn(), MAX_UPLOAD_BYTES: 524_288_000 }));
vi.mock('@/lib/autoMetadataImport', () => ({ importMetadata: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  let data: Record<string, unknown> | undefined;
  const builder = {
    insert: (value: Record<string, unknown>) => { data = value; inserted.push({ table, data: value }); return builder; },
    select: () => builder,
    eq: () => builder,
    single: async () => ({ error: null, data: data ? { id: `${table}-${inserted.filter((row) => row.table === table).length}` } : { records: [{ id: `records-${inserted.filter((row) => row.table === 'records').length}` }] } }),
  };
  return builder;
} } }));

function setup(files: File[]) {
  render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><NewWork /></QueryClientProvider></MemoryRouter>);
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload and add to library' }));
}

beforeEach(() => { vi.clearAllMocks(); inserted.length = 0; vi.mocked(importMetadata).mockResolvedValue(undefined); });

describe('batch uploads', () => {
  it('opens a single uploaded work immediately without waiting for identifier extraction', async () => {
    vi.mocked(uploadFile).mockResolvedValue({ status: 'created', asset: {} as never });
    vi.mocked(importMetadata).mockImplementation(() => new Promise(() => {}));
    setup([new File(['no identifier'], 'lua.pdf')]);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/library/works-1?autofill=1'));
    expect(importMetadata).not.toHaveBeenCalled();
  });
  it('creates and enriches separate works, reports progress weighted by bytes, and opens newest-first library', async () => {
    let finishFirst: () => void = () => {};
    vi.mocked(uploadFile).mockImplementationOnce(async (_record, _role, _file, progress) => {
      progress?.(0.5);
      await new Promise<void>((resolve) => { finishFirst = resolve; });
      return { status: 'created', asset: {} as never };
    }).mockResolvedValue({ status: 'created', asset: {} as never });
    const files = [new File(['1234'], 'first.pdf'), new File(['123456789012'], 'second.pdf')];
    setup(files);
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Uploading first.pdf' })).toHaveAttribute('value', '0.5'));
    expect(screen.getByRole('progressbar', { name: 'Total upload' })).toHaveAttribute('value', '2');
    expect(screen.getByRole('progressbar', { name: 'Total upload' })).toHaveAttribute('max', '16');
    finishFirst();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/library?sort=added'));
    expect(inserted.filter((row) => row.table === 'works').map((row) => row.data.title)).toEqual(['first', 'second']);
    expect(uploadFile).toHaveBeenNthCalledWith(1, 'records-1', 'primary', files[0], expect.any(Function));
    expect(uploadFile).toHaveBeenNthCalledWith(2, 'records-2', 'primary', files[1], expect.any(Function));
    expect(importMetadata).toHaveBeenCalledTimes(2);
  });

  it('continues after a failure and retries it without duplicating either work', async () => {
    vi.mocked(uploadFile).mockRejectedValueOnce(new Error('Network interrupted')).mockResolvedValue({ status: 'created', asset: {} as never });
    setup([new File(['a'], 'first.pdf'), new File(['b'], 'second.pdf')]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network interrupted');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry failed uploads' })).toBeEnabled());
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed uploads' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/library?sort=added'));
    expect(inserted.filter((row) => row.table === 'works')).toHaveLength(2);
    expect(uploadFile).toHaveBeenCalledTimes(3);
  });
});
