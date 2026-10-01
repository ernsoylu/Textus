import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Login } from './Login';

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn(), signInWithOtp: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth }, turnstileSiteKey: 'site-key' }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ session: null }) }));
// The real widget loads Cloudflare's script; the fake solves the challenge on click.
vi.mock('@/components/account/Turnstile', () => ({
  Turnstile: ({ onToken }: { onToken: (token: string) => void }) => <button type="button" onClick={() => onToken('solved')}>Solve check</button>,
}));

function renderLogin() {
  render(<MemoryRouter><Login /></MemoryRouter>);
}

describe('Login', () => {
  beforeEach(() => {
    auth.signInWithPassword.mockReset().mockResolvedValue({ error: null });
    auth.signInWithOtp.mockReset().mockResolvedValue({ error: null });
  });

  it('offers no public sign-up', () => {
    renderLogin();
    expect(screen.queryByText(/create an account/i)).toBeNull();
  });

  it('requires the security check, then sends its token to Auth once', async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'owner@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Complete the security check.');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Solve check' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'owner@example.test', password: 'secret', options: { captchaToken: 'solved' } }));

    // Tokens are single-use: a retry needs a fresh challenge.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Complete the security check.');
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);
  });

  it('never lets a magic link create an account', async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'owner@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Solve check' }));
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    await waitFor(() => expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: 'owner@example.test', options: expect.objectContaining({ shouldCreateUser: false, captchaToken: 'solved' }) }));
  });
});
