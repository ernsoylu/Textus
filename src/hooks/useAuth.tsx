import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/queryClient';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

// FR-AUTH-1/2: session lives here; every query below relies on RLS ((select auth.uid()))
// to scope results, not on anything this context does.
type AuthState = {
  session: Session | null;
  loading: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let changed = false;
    supabase.auth.getSession().then(({ data }) => {
      if (active && !changed) setSession(data.session);
      if (active) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      changed = true;
      setSession(next);
      setLoading(false);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  // A new identity gets a new client and a remounted subtree: late requests/mutations
  // can only update the old client, never the next account's cache or component state.
  const owner = session?.user.id ?? "signed-out";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- cache identity is deliberately the owner
  const client = useMemo(() => createQueryClient(), [owner]);
  useEffect(() => () => { void client.cancelQueries(); client.clear(); }, [client]);

  const value = useMemo(() => ({ session, loading }), [session, loading]);
  return <AuthContext.Provider value={value}><QueryClientProvider key={owner} client={client}>{children}</QueryClientProvider></AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
