import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { UnsavedChangesGuard } from './UnsavedChangesGuard';

function setup(dirty: boolean, onSave?: () => Promise<unknown>) {
  const router = createMemoryRouter(
    [
      { path: '/edit', element: (<><UnsavedChangesGuard dirty={dirty} subject="edition" onSave={onSave} /><Link to="/other">Leave</Link></>) },
      { path: '/other', element: <p>Other page</p> },
    ],
    { initialEntries: ['/edit'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('UnsavedChangesGuard', () => {
  it('lets a clean form navigate away', async () => {
    setup(false);
    fireEvent.click(screen.getByText('Leave'));
    expect(await screen.findByText('Other page')).toBeInTheDocument();
  });

  it('blocks a dirty form, and discarding continues the navigation', async () => {
    const router = setup(true);
    fireEvent.click(screen.getByText('Leave'));
    expect(await screen.findByText('You have unsaved edits to this edition.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/edit');
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/other'));
  });

  it('keeps editing on cancel, and saves before leaving', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const router = setup(true, onSave);
    fireEvent.click(screen.getByText('Leave'));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.pathname).toBe('/edit');
    fireEvent.click(screen.getByText('Leave'));
    fireEvent.click(await screen.findByRole('button', { name: 'Save and leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/other'));
    expect(onSave).toHaveBeenCalledOnce();
  });
});
