import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadForm } from './UploadForm';
import { uploadFile } from '@/hooks/useUploadAsset';

vi.mock('@/hooks/useUploadAsset', () => ({ uploadFile: vi.fn() }));

describe('UploadForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads a chosen file and reports completion', async () => {
    vi.mocked(uploadFile).mockResolvedValue({ status: 'created', asset: {} as never });
    const queryClient = new QueryClient();
    render(<QueryClientProvider client={queryClient}><UploadForm recordId="record-1" /></QueryClientProvider>);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['pdf'], 'paper.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText('Uploaded')).toBeInTheDocument();
    expect(uploadFile).toHaveBeenCalledWith('record-1', 'primary', file, expect.any(Function));
  });

  it('explains failure and retries the same file', async () => {
    vi.mocked(uploadFile).mockRejectedValueOnce(new Error('Network interrupted')).mockResolvedValueOnce({ status: 'created', asset: {} as never });
    render(<QueryClientProvider client={new QueryClient()}><UploadForm recordId="record-1" /></QueryClientProvider>);
    const file = new File(['pdf'], 'paper.pdf', { type: 'application/pdf' });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });

    expect(await screen.findByText('Network interrupted')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Uploaded')).toBeInTheDocument();
  });
});
