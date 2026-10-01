vi.mock('./ActivityCount', () => ({ ActivityCount: () => null }));
import { vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { MobileNav } from './MobileNav';

describe('mobile navigation', () => {
  it('opens all pages from More and closes after selecting a destination', () => {
    render(<MemoryRouter initialEntries={['/library/new']}><MobileNav /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Add' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'false');
    const more = screen.getByRole('button', { name: 'More' });
    fireEvent.click(more);
    const dialog = screen.getByRole('dialog', { name: 'Explore your library' });
    expect(more).toHaveAttribute('aria-expanded', 'true');
    for (const name of ['Collections', 'Contributors', 'Serials', 'Tags', 'Import', 'Activity', 'Settings']) {
      expect(within(dialog).getByRole('link', { name })).toBeInTheDocument();
    }
    fireEvent.click(within(dialog).getByRole('link', { name: 'Collections' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveClass('text-green');
  });
});
