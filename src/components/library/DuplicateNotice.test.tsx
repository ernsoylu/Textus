import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DuplicateNotice } from './DuplicateNotice';
import { findDuplicateWorks, mergeWorks } from '@/lib/duplicates';

vi.mock('@/lib/duplicates', () => ({ DUPLICATE_REASON_LABELS: { same_file: 'same file' }, findDuplicateWorks: vi.fn(), mergeWorks: vi.fn() }));

describe('DuplicateNotice', () => {
  it('merges the other work into this one only after confirmation', async () => {
    vi.mocked(findDuplicateWorks).mockResolvedValue([{ work_id: 'other', title: 'Heat Transfer', reason: 'same_file' }]);
    vi.mocked(mergeWorks).mockResolvedValue();
    render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><DuplicateNotice workId="this" /></QueryClientProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Merge into this book' }));
    expect(mergeWorks).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }));
    await waitFor(() => expect(mergeWorks).toHaveBeenCalledWith('this', 'other'));
  });
});
