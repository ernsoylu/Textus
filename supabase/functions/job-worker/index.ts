// Edge Function: job-worker (§8.3). Invoked by pg_cron every minute (§7.5, set up directly
// against the server, not in a migration — see the README). Requires the service role
// ('secret' auth mode) — this is the one function CLAUDE.md's own convention exempts from
// per-caller JWT auth.
//
// Scope of this pass: extract_text for PDF assets only (real pdfjs-dist text extraction,
// verified against a live signed URL before this was written — see the M1 session notes).
// EPUB/MOBI/AZW3/CBZ/DjVu/HTML/TXT extraction isn't implemented; those jobs succeed as a no-op
// rather than failing forever on a format this will never handle.
//
// generate_thumbnail has no handler here at all, deliberately: thumbnails are captured
// client-side on first read instead (Reader.tsx's onFirstPageRendered), per §15 open
// question 2's own proposed resolution — Deno's edge runtime has no canvas to rasterize a
// PDF page into an image. upload/complete no longer enqueues that job type.
import { withSupabase, type SupabaseContext } from '@supabase/server';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractEpub, identifierSuggestions } from './epub.ts';
import { needsJournalRefresh, provider, providersFor } from '../metadata-lookup/index.ts';
import { runCleanup } from './cleanup.ts';
import { checked, withBudget, boundedFetch as fetch } from '../_shared/budget.ts';

// ponytail: buffer at most 25 MB inside the 150 MB edge worker; use PDF range requests for larger-file extraction.
const MAX_EXTRACT_BYTES = 25_000_000;
const MAX_STORED_TEXT_CHARS = 100_000; // the search index covers the first 100,000 characters (migration 20260929000003)

interface Job {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  claim_generation: number;
  user_id: string | null;
}

// deno-lint-ignore no-explicit-any
async function queueMetadata(admin: any, asset: { id: string; user_id: string }, found: { scheme: 'isbn' | 'doi'; value: string }[]) {
  if (!found.length) return;
  const { data: links, error } = await admin.from('record_assets').select('record_id').eq('asset_id', asset.id);
  if (error) throw error;
  for (const link of links ?? []) {
    for (const identifier of found.slice(0, 3)) {
      const { error: queueError } = await admin.from('jobs').upsert({ user_id: asset.user_id, job_type: 'fetch_metadata', payload: { record_id: link.record_id, ...identifier }, idempotency_key: `fetch_metadata:${link.record_id}:${identifier.scheme}:${identifier.value}` }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
      if (queueError) throw queueError;
    }
  }
}

// Extracted text feeds search (asset_texts, FR-SRCH-1): a capped copy, one row per asset, replaced on re-extraction.
// deno-lint-ignore no-explicit-any
async function storeText(admin: any, asset: { id: string; user_id: string }, text: string) {
  const content = text.replaceAll('\u0000', '').trim().slice(0, MAX_STORED_TEXT_CHARS);
  if (!content) return;
  const { error } = await admin.from('asset_texts').upsert({ asset_id: asset.id, user_id: asset.user_id, content }, { onConflict: 'asset_id' });
  if (error) throw error;
}

// admin: a service-role SupabaseClient (ctx.supabaseAdmin) — untyped here since this Deno
// file has no local Database type to import (see the upload function's equivalent note).
// deno-lint-ignore no-explicit-any
async function extractText(admin: any, job: Job) {
  const assetId = job.payload.asset_id as string | undefined;
  if (!assetId) throw new Error('extract_text job missing payload.asset_id');

  const { data: asset, error: assetError } = await admin.from('assets').select('*').eq('id', assetId).eq('user_id', job.user_id!).is('deleting_at', null).single();
  if (assetError || !asset) throw new Error(assetError?.message ?? 'asset not found');

  // Text is read into memory, so very large files and formats with no extractor are marked ready without it
  // (otherwise their asset would stay `pending` forever).
  let skipReason: string | null = null;
  if (asset.file_format !== 'pdf' && asset.file_format !== 'epub') skipReason = `text extraction for '${asset.file_format}' is not implemented yet`;
  else if (asset.file_size > MAX_EXTRACT_BYTES) skipReason = 'file is too large for text extraction';
  if (skipReason) {
    const filename = typeof job.payload.filename === 'string' ? job.payload.filename : '';
    const found = identifierSuggestions('', filename);
    const { error: readyError } = await admin.from('assets').update({ metadata: { ...(asset.metadata as object), filename, identifier_suggestions: found }, processing_state: 'ready' }).eq('id', assetId);
    if (readyError) throw readyError;
    await queueMetadata(admin, asset, found);
    return { skipped: true, reason: skipReason };
  }

  const { data: file, error: downloadError } = await admin.storage.from(asset.bucket).download(asset.storage_path);
  if (downloadError || !file) throw new Error(downloadError?.message ?? 'could not download asset');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const filename = typeof job.payload.filename === 'string' ? job.payload.filename : '';
  if (asset.file_format === 'epub') {
    const result = extractEpub(bytes);
    const found = identifierSuggestions(result.text, filename);
    await storeText(admin, asset, result.text);
    const { error: updateError } = await admin.from('assets').update({ metadata: { ...(asset.metadata as object), filename, text_char_count: result.text.length, text_preview: result.text.slice(0, 2000), identifier_suggestions: found, author_suggestion: result.author ?? null, title_suggestion: result.title ?? null }, processing_state: 'ready' }).eq('id', assetId);
    if (updateError) throw updateError;
    await queueMetadata(admin, asset, found);
    return { textCharCount: result.text.length };
  }

  // No `disableWorker` option exists on DocumentInitParameters (checked against the real
  // .d.ts, not assumed) — pdfjs falls back to an in-thread "fake worker" automatically
  // whenever no real worker is configured, which is always true here since GlobalWorkerOptions
  // is never set in this function.
  const task = pdfjsLib.getDocument({ data: bytes });
  const doc = await task.promise;
  try {
    const pagesToScan = Math.min(doc.numPages, 8);
    let text = '';
    for (let i = 1; i <= pagesToScan; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // content.items is (TextItem | TextMarkedContent)[] — only TextItem has `str`.
      text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ') + '\n';
    }

    const pdfMeta = await doc.getMetadata().catch(() => null);
    const info = pdfMeta?.info as { Author?: string; Title?: string } | undefined;

    // ponytail: PDF search indexes the first eight pages; scan the whole document if users need full-book search.
    const found = identifierSuggestions(text, filename);
    await storeText(admin, asset, text);
    const { error: updateError } = await admin
      .from('assets')
      .update({
        metadata: { ...(asset.metadata as object), filename, page_count: doc.numPages, text_char_count: text.length, text_preview: text.slice(0, 2000), identifier_suggestions: found, author_suggestion: info?.Author ?? null, title_suggestion: info?.Title ?? null },
        processing_state: 'ready',
      })
      .eq('id', assetId);
    if (updateError) throw updateError;
    await queueMetadata(admin, asset, found);

    return { pageCount: doc.numPages, textCharCount: text.length };
  } finally {
    await task.destroy();
  }
}

const CACHE_TTL_MS = 30 * 86_400_000;

// deno-lint-ignore no-explicit-any
async function cachedSuggestion(admin: any, scheme: string, value: string) {
  const { data: cached } = await admin.from('metadata_cache').select('response_data').eq('identifier_scheme', scheme).eq('identifier_value', value).gt('expires_at', new Date().toISOString()).order(scheme === 'doi' ? 'provider' : 'fetched_at', { ascending: scheme === 'doi' }).order('fetched_at', { ascending: false }).limit(1).maybeSingle();
  return needsJournalRefresh(cached?.response_data) ? undefined : cached?.response_data;
}

// Tries each provider in order and caches the first hit. A provider failure is only raised when
// nothing succeeded, so a later provider can still rescue the lookup.
// deno-lint-ignore no-explicit-any
async function providerSuggestion(admin: any, scheme: 'isbn' | 'doi', value: string) {
  const providers = providersFor(scheme);
  let failure = '';
  for (const name of providers) {
    const result = await provider(name, name === 'semantic_scholar' ? `DOI:${value}` : value);
    if (result.kind === 'success') {
      const { error } = await admin.from('metadata_cache').upsert({ identifier_scheme: scheme, identifier_value: value, provider: name, response_data: result.data, fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString() }, { onConflict: 'identifier_scheme,identifier_value,provider' });
      if (error) throw error;
      return result.data;
    }
    if (result.kind === 'provider_error') failure = result.message;
    if (result.kind === 'rate_limited') failure = `rate limited by ${name}`;
  }
  if (failure) throw new Error(failure);
  return undefined;
}

// Background enrichment only writes a suggestion; the user still confirms every field.
// deno-lint-ignore no-explicit-any
async function fetchMetadata(admin: any, job: Job) {
  const { record_id: recordId, scheme, value } = job.payload;
  if (typeof recordId !== 'string' || (scheme !== 'isbn' && scheme !== 'doi') || typeof value !== 'string') throw new Error('invalid fetch_metadata payload');
  const { data: record, error: recordError } = await admin.from('records').select('metadata').eq('id', recordId).single();
  if (recordError || !record) throw new Error('record not found');
  const suggestion = (await cachedSuggestion(admin, scheme, value)) ?? (await providerSuggestion(admin, scheme, value));
  if (!suggestion) return { found: false };
  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  const suggestions = (metadata.lookup_suggestions ?? {}) as Record<string, unknown>;
  const { error } = await admin.from('records').update({ metadata: { ...metadata, lookup_suggestions: { ...suggestions, [`${scheme}:${value}`]: { data: suggestion, fetched_at: new Date().toISOString() } } } }).eq('id', recordId);
  if (error) throw error;
  return { found: true };
}

const MAX_COVER_BYTES = 5_000_000;
const COVER_REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function coverHostAllowed(hostname: string): boolean {
  return hostname === 'archive.org' || hostname.endsWith('.us.archive.org') || hostname === 'covers.openlibrary.org';
}

function parseCoverUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'covers.openlibrary.org') throw new Error('cover host is not allowed');
  return url;
}

async function fetchCoverResponse(start: URL): Promise<Response> {
  let url = start;
  for (let redirects = 0;; redirects++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'manual' });
    if (!COVER_REDIRECT_STATUSES.has(response.status)) return response;
    if (redirects >= 3) throw new Error('too many cover redirects');
    const location = response.headers.get('location');
    if (!location) throw new Error('cover redirect missing location');
    const next = new URL(location, url);
    if (next.protocol !== 'https:' || !coverHostAllowed(next.hostname)) throw new Error('cover redirect host is not allowed');
    url = next;
  }
}

async function readCoverBytes(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok) throw new Error(`cover provider HTTP ${response.status}`);
  if (Number(response.headers.get('content-length') ?? 0) > MAX_COVER_BYTES) throw new Error('cover too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty cover response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_COVER_BYTES) { await reader.cancel(); throw new Error('cover too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

// Never trust the provider's content type: classify from the bytes (invariant 6).
function sniffCover(bytes: Uint8Array): { extension: 'jpg' | 'png'; mime: string } {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: 'jpg', mime: 'image/jpeg' };
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return { extension: 'png', mime: 'image/png' };
  throw new Error('unsupported cover bytes');
}

async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Content-addressed: the same bytes for the same user are one asset. A concurrent insert that
// loses the unique-constraint race reads the winner's row instead.
// deno-lint-ignore no-explicit-any
async function ensureCoverAsset(admin: any, userId: string, path: string, size: number, checksum: string, mime: string): Promise<{ id: string }> {
  const { data: existing } = await admin.from('assets').select('id').eq('user_id', userId).eq('checksum_sha256', checksum).maybeSingle();
  if (existing) return existing;
  const { data: created, error } = await admin.from('assets').insert({ user_id: userId, bucket: 'covers', storage_path: path, file_size: size, checksum_sha256: checksum, mime_type: mime, file_format: 'image', processing_state: 'ready' }).select('id').single();
  if (!error) return created;
  if (error.code !== '23505') throw error;
  const { data: raced, error: raceError } = await admin.from('assets').select('id').eq('user_id', userId).eq('checksum_sha256', checksum).single();
  if (raceError) throw raceError;
  return raced;
}

// Provider covers are public bytes but enter the private, content-addressed asset store.
// deno-lint-ignore no-explicit-any
async function processCover(admin: any, job: Job) {
  const recordId = job.payload.record_id;
  const rawUrl = job.payload.url;
  if (typeof recordId !== 'string' || typeof rawUrl !== 'string') throw new Error('invalid process_cover payload');
  const coverUrl = parseCoverUrl(rawUrl);
  const { data: record, error: recordError } = await admin.from('records').select('id,works(user_id)').eq('id', recordId).single();
  if (recordError || !record) throw new Error('record not found');
  const userId = record.works?.user_id;
  if (!userId) throw new Error('record owner not found');
  const bytes = await readCoverBytes(await fetchCoverResponse(coverUrl));
  const { extension, mime } = sniffCover(bytes);
  const checksum = await sha256Hex(bytes);
  const path = `${userId}/${checksum}.${extension}`;
  const { error: storageError } = await admin.storage.from('covers').upload(path, bytes, { contentType: mime, upsert: false });
  if (storageError) {
    const { data: exists } = await admin.storage.from('covers').exists(path);
    if (!exists) throw storageError;
  }
  const asset = await ensureCoverAsset(admin, userId, path, bytes.length, checksum, mime);
  const { error: linkError } = await admin.from('record_assets').upsert({ record_id: recordId, asset_id: asset.id, role: 'cover' }, { onConflict: 'record_id,asset_id,role', ignoreDuplicates: true });
  if (linkError) throw linkError;
  return { asset_id: asset.id };
}

// deno-lint-ignore no-explicit-any
const HANDLERS: Record<string, (admin: any, job: Job) => Promise<unknown>> = {
  extract_text: extractText,
  process_cover: processCover,
  fetch_metadata: fetchMetadata,
  cleanup: (admin) => runCleanup(admin),
};

export default {
  fetch: withSupabase({ auth: 'secret' }, withBudget(async (_req: Request, ctx: SupabaseContext) => {
    await checked(ctx.supabaseAdmin.rpc('expire_stale_jobs'));
    await checked(ctx.supabaseAdmin.from('jobs').upsert(
      { user_id: null, job_type: 'cleanup', payload: {}, idempotency_key: `cleanup:${new Date().toISOString().slice(0, 10)}` },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    ));
    const jobs = await checked(ctx.supabaseAdmin.rpc('claim_jobs', { p_limit: 1 })) as Job[];
    const results = [];
    for (const job of jobs ?? []) {
      try {
        const handler = HANDLERS[job.job_type];
        if (!handler) throw new Error('unsupported job type');
        const result = await handler(ctx.supabaseAdmin, job);
        const committed = await checked(ctx.supabaseAdmin.rpc('finish_job', { p_id: job.id, p_generation: job.claim_generation, p_result: result }));
        results.push({ id: job.id, status: committed ? 'succeeded' : 'lease_lost' });
      } catch {
        // Logs/results contain neither provider URLs, book text nor credentials.
        const committed = await checked(ctx.supabaseAdmin.rpc('finish_job', { p_id: job.id, p_generation: job.claim_generation, p_error: 'Processing failed. Retry from Activity.' }));
        results.push({ id: job.id, status: committed ? 'retry_or_failed' : 'lease_lost' });
      }
    }
    return Response.json({ claimed: jobs?.length ?? 0, results });
  })),
};
