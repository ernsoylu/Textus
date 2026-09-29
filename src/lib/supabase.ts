import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Anon key only — see CLAUDE.md invariant 9. Service role and provider keys
// exist only in Edge Functions, never here.
//
// VITE_SUPABASE_URL is optional: unset, the SPA talks to its own origin, where the production
// image's nginx proxies /auth, /rest, /storage and /functions to Supabase over the internal
// Docker network (deploy/nginx.conf).
export const supabaseUrl: string = import.meta.env.VITE_SUPABASE_URL || globalThis.location.origin;
export const supabaseAnonKey: string = import.meta.env.VITE_SUPABASE_ANON_KEY;
const anonKey = supabaseAnonKey;

if (!anonKey) {
  throw new Error('VITE_SUPABASE_ANON_KEY must be set (see .env.example).');
}

export const supabase = createClient<Database>(supabaseUrl, anonKey);
