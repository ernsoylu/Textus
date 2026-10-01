import { act, render, screen, waitFor } from '@testing-library/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
const state = vi.hoisted(() => ({ notify: vi.fn<(event: string, session: Session | null) => void>() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: {
  getSession: () => Promise.resolve({ data: { session: { user: { id: 'A' } } } }),
  onAuthStateChange: (fn: typeof state.notify) => { state.notify = fn; return { data: { subscription: { unsubscribe: vi.fn() } } }; },
} } }));
import { AuthProvider, useAuth } from './useAuth';

function PrivateData() {
  const { session } = useAuth();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['private'], queryFn: () => Promise.resolve(session?.user.id ?? 'none') });
  return <div>{session?.user.id}:{query.data}<button onClick={() => client.setQueryData(['private'], 'secret-A')}>Cache</button></div>;
}
describe('auth identity boundary', () => {
  it('does not show the previous account cache on sign-out/sign-in without reload', async () => {
    render(<AuthProvider><PrivateData /></AuthProvider>);
    await screen.findByText('A:A');
    act(() => screen.getByText('Cache').click());
    await screen.findByText('A:secret-A');
    act(() => state.notify('SIGNED_OUT', null));
    act(() => state.notify('SIGNED_IN', { user: { id: 'B' } } as Session));
    await waitFor(() => expect(screen.getByText('B:B')).toBeInTheDocument());
    expect(screen.queryByText(/secret-A/)).not.toBeInTheDocument();
  });
});
