import { supabase } from './supabase';

// Typed Edge Function invocations (§12). Edge Functions authenticate the caller from the
// Authorization JWT themselves (§8) — this just attaches the current session's access token.
async function callFunction<T>(path: string, body: unknown): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Not signed in.');

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok && !('status' in json)) {
    // Function-level errors (400/404/500) use { error, ... }; upload/complete's own
    // "rejected" outcome is a 200 with a typed status and is returned as-is below.
    throw new Error(typeof json.error === 'string' ? json.error : `Request failed (${res.status})`);
  }
  return json as T;
}

export interface UploadIntentResponse {
  path: string;
  token: string;
}

export type UploadCompleteResponse =
  | { status: 'created' | 'deduplicated'; asset: import('@/types').AssetRow }
  | { status: 'rejected'; reason: 'missing' | 'size_mismatch' | 'unsupported_type' };

export function uploadIntent(body: { uploadId: string; recordId: string; filename: string; size: number }) {
  return callFunction<UploadIntentResponse>('upload/intent', body);
}

export function uploadComplete(body: { uploadId: string; recordId: string; role: 'primary' | 'supplement' | 'cover' }) {
  return callFunction<UploadCompleteResponse>('upload/complete', body);
}
