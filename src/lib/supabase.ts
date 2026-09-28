import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

// Anon key only — see CLAUDE.md invariant 9. Service role and provider keys
// exist only in Edge Functions, never here.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (see .env.example).');
}

export const supabase = createClient<Database>(url, anonKey);
