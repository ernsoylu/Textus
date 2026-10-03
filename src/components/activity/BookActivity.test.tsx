import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { BookActivity } from './BookActivity';
import type { ActivityRow } from '@/lib/activityStage';

const row: ActivityRow = {
  asset_id: 'asset-1', work_id: 'work-1', record_id: 'rec-1', title: 'Heat Transfer', byline: 'M. Necati Özışık', file_format: 'pdf', file_size: 1, added_at: '2026-10-02T00:00:00Z',
  processing_state: 'ready', processing_error: null, passage_index: { status: 'failed', done: 6, total: 10, passages: 6 }, embedding_index: null, index_job: null, queue_ahead: null, embed_job: null,
  pending_steps: [], failed_steps: [],
};

it('shows the book, its steps, progress and a retry for a failed index', () => {
  const onControl = vi.fn();
  render(<MemoryRouter><ul><BookActivity row={row} busy={false} onControl={onControl} /></ul></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'Heat Transfer' })).toHaveAttribute('href', '/library/work-1');
  expect(screen.getByText('Needs attention')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'Heat Transfer progress' })).toHaveAttribute('aria-valuenow', '20');
  expect(screen.getByText(/Full-text search/)).toHaveTextContent('failed');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onControl).toHaveBeenCalledWith('retry', 'asset-1');
});

it('moves a waiting book to the top of the queue', () => {
  const onControl = vi.fn();
  const waiting = { ...row, passage_index: { status: 'complete', done: 10, total: 10, passages: 40 }, embed_job: 'queued', queue_ahead: 3 };
  render(<MemoryRouter><ul><BookActivity row={waiting} busy={false} onControl={onControl} /></ul></MemoryRouter>);
  expect(screen.getByText(/Waiting to be prepared for AI search — 3 books ahead/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Move to top' }));
  expect(onControl).toHaveBeenCalledWith('top', 'asset-1');
});

it('offers Retry when reading failed before passage indexing started', () => {
  const onControl = vi.fn();
  render(<MemoryRouter><ul><BookActivity row={{ ...row, processing_state: 'failed', passage_index: null, processing_error: 'Text extraction failed. Retry from Activity.' }} busy={false} onControl={onControl} /></ul></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onControl).toHaveBeenCalledWith('retry', 'asset-1');
});
