import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { UnsavedChangesGuard, UnsavedChangesProvider } from './UnsavedChangesGuard';

interface FormProps { dirty: boolean; subject: string; onSave?: () => Promise<unknown> }

function setup(forms: FormProps[]) {
  const router = createMemoryRouter(
    [
      {
        path: '/edit',
        element: (
          <UnsavedChangesProvider>
            {forms.map((f) => <UnsavedChangesGuard key={f.subject} {...f} />)}
            <Link to="/other">Leave</Link>
          </UnsavedChangesProvider>
        ),
      },
      { path: '/other', element: <p>Other page</p> },
    ],
    { initialEntries: ['/edit'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('UnsavedChangesGuard', () => {
  it('lets a clean form navigate away', async () => {
    setup([{ dirty: false, subject: 'edition' }]);
    fireEvent.click(screen.getByText('Leave'));
    expect(await screen.findByText('Other page')).toBeInTheDocument();
  });

  it('blocks a dirty form, and discarding continues the navigation', async () => {
    const router = setup([{ dirty: true, subject: 'edition' }]);
    fireEvent.click(screen.getByText('Leave'));
    expect(await screen.findByText('You have unsaved edits to this edition.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/edit');
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/other'));
  });

  it('keeps editing on cancel, and saves before leaving', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const router = setup([{ dirty: true, subject: 'edition', onSave }]);
    fireEvent.click(screen.getByText('Leave'));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(router.state.location.pathname).toBe('/edit');
    fireEvent.click(screen.getByText('Leave'));
    fireEvent.click(await screen.findByRole('button', { name: 'Save and leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/other'));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('handles several dirty forms on one page with a single dialog, saving each', async () => {
    const saveWork = vi.fn().mockResolvedValue(undefined);
    const saveEdition = vi.fn().mockResolvedValue(undefined);
    const router = setup([
      { dirty: true, subject: 'work', onSave: saveWork },
      { dirty: true, subject: 'edition', onSave: saveEdition },
      { dirty: false, subject: 'other form' },
    ]);
    fireEvent.click(screen.getByText('Leave'));
    expect(await screen.findByText('You have unsaved edits to this work and edition.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save and leave' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/other'));
    expect(saveWork).toHaveBeenCalledOnce();
    expect(saveEdition).toHaveBeenCalledOnce();
  });
});
