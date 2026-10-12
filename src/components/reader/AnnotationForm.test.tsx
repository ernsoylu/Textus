import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnnotationForm } from './AnnotationForm';

// FR-READ-12 / gap G07: a failed save used to clear the comment before the request finished.
describe('AnnotationForm', () => {
  it('keeps the comment after a failed save and clears it only after a successful retry', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('Server error (500).')).mockResolvedValueOnce('id');
    render(<AnnotationForm label="Save comment" onSubmit={onSubmit} />);
    const box = screen.getByLabelText('Comment');
    fireEvent.change(box, { target: { value: 'An important point' } });
    fireEvent.click(screen.getByRole('radio', { name: 'green' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error (500).');
    expect(box).toHaveValue('An important point');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(box).toHaveValue(''));
    expect(onSubmit).toHaveBeenNthCalledWith(2, 'green', 'An important point');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('asks before discarding a written comment', () => {
    const onCancel = vi.fn();
    render(<AnnotationForm label="Save comment" onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('cancels an empty form at once', () => {
    const onCancel = vi.fn();
    render(<AnnotationForm label="Save comment" onSubmit={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
