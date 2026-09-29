import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

const base = { title: 'Delete work?', description: 'This cannot be undone.', confirmLabel: 'Delete', onConfirm: vi.fn(), onClose: vi.fn() };

describe('ConfirmDialog', () => {
  it('opens as a modal and confirms', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...base} open onConfirm={onConfirm} />);
    expect(screen.getByRole('dialog', { name: 'Delete work?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('cancels', () => {
    const onClose = vi.fn();
    render(<ConfirmDialog {...base} open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps confirm disabled until the required word is typed', () => {
    render(<ConfirmDialog {...base} open requireText="DELETE" />);
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type DELETE/), { target: { value: 'DELETE' } });
    expect(confirm).toBeEnabled();
  });
});
