import { supabase, supabaseUrl } from './supabase';
import type { IdentifierScheme, StandardScheme } from 'shared/identifier';

// Typed Edge Function invocations (§12). Edge Functions authenticate the caller from the
// Authorization JWT themselves (§8) — this just attaches the current session's access token.
async function callFunction<T>(path: string, body: unknown): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Not signed in.');

  const res = await fetch(`${supabaseUrl}/functions/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  // A gateway or crash can answer with plain text; never let that surface as a JSON parse error.
  const json = await res.json().catch(() => ({ error: `Request failed (${res.status}).` }));
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
  // FR-CAT-7: these bytes are already a file of another work; nothing was linked.
  | { status: 'duplicate'; workId: string; asset: import('@/types').AssetRow }
  | { status: 'rejected'; reason: 'missing' | 'size_mismatch' | 'unsupported_type' | 'unreachable' };

export function uploadIntent(body: { uploadId: string; recordId: string; filename: string; size: number }) {
  return callFunction<UploadIntentResponse>('upload/intent', body);
}

export function uploadComplete(body: { uploadId: string; recordId: string; role: 'primary' | 'supplement' | 'cover'; filename: string }) {
  return callFunction<UploadCompleteResponse>('upload/complete', body);
}

// The server downloads the link (invariant 9) and finishes like uploadComplete.
export function uploadFromUrl(body: { uploadId: string; recordId: string; role: 'primary' | 'supplement' | 'cover'; url: string }) {
  return callFunction<UploadCompleteResponse>('upload/from-url', body);
}

export interface NormalizedMetadata {
  title?: string;
  subtitle?: string;
  abstract?: string;
  language?: string;
  publication_date?: string;
  publication_date_precision?: 'year' | 'month' | 'day';
  publisher?: string;
  edition?: string;
  standard_scheme?: StandardScheme;
  standard_reference?: string;
  standard_status?: string;
  container_title?: string | null;
  volume?: string;
  issue_number?: string;
  pages?: string;
  contributors?: { name: string; given?: string; family?: string; role: 'author' | 'editor'; identifiers?: Record<string, string>; affiliation?: string }[];
  cover_url?: string;
  role_warning?: string;
  source_provider: string;
  source_url?: string;
  work_type: string;
}

export type MetadataResponse =
  | { status: 'success'; data: NormalizedMetadata; fromCache: boolean; fetchedAt: string }
  | { status: 'not_found'; identifier: string; searchedProviders: string[] }
  | { status: 'invalid_identifier'; scheme: string; reason: string }
  | { status: 'rate_limited'; retryAfterMs: number; provider: string }
  | { status: 'provider_error'; provider: string; message: string };

export function metadataLookup(scheme: IdentifierScheme, value: string, bypassCache = false) {
  return callFunction<MetadataResponse>('metadata-lookup', { identifier: { scheme, value }, bypassCache });
}

export function queueCover(recordId: string, url: string) {
  return callFunction<{ status: 'queued' }>('metadata-lookup', { action: 'queue-cover', recordId, url });
}

export interface ExportResponse {
  format: string;
  filename: string;
  mime: string;
  content: string;
  count: number;
}

export function exportRecords(recordIds: string[], format: 'bibtex' | 'ris' | 'csl-json') {
  return callFunction<ExportResponse>('export', { recordIds, format });
}

// Deletes the signed-in user's account, library and files (§8.6). Irreversible.
export function deleteAccount() {
  return callFunction<{ status: 'deleted'; objectsRemoved: number }>('delete-account', { confirm: 'DELETE' });
}

export interface AiStatus { agentsEnabled: boolean; agentWritesEnabled: boolean; enabled: boolean; reachable: boolean; defaultModel: string; embedModel: string; selectedModel: string }
export interface AiModel { name: string; family?: string; parameterSize?: string; quantization?: string; sizeBytes: number }
export const aiStatus = () => callFunction<AiStatus>('ai', { action: 'status' });
export const aiModels = () => callFunction<{ models: AiModel[] }>('ai', { action: 'models' });
export interface SourceResult { sources: { workId: string; recordId: string; assetId: string; title: string; byline: string | null; year: number | null; page: number | null; pageLabel: string | null; cfi: string | null; quote: string; passage: string; link: string }[]; searched: number; mode: 'hybrid' | 'fts'; verified: boolean; coverage: { indexedAssets: number; eligibleAssets: number; partial: boolean }; warning?: string }
export const findSources = (question: string) => callFunction<SourceResult>('ai', { action: 'find-sources', question });

export const titleMetadataSearch = (recordId: string, title: string, author: string) => callFunction<{ candidates: { data: NormalizedMetadata; identifier?: { scheme: 'isbn' | 'doi'; value: string } }[] }>('metadata-lookup', { action: 'search-title', recordId, title, author, consent: true });
