// Edge Function: job-worker (§8.3). Invoked by pg_cron every minute (§7.5, set up directly
// against the server, not in a migration — see the README). Requires the service role
// ('secret' auth mode) — this is the one function CLAUDE.md's own convention exempts from
// per-caller JWT auth.
//
// Scope of this pass: extract_text for PDF assets only (real pdfjs-dist text extraction,
// verified against a live signed URL before this was written — see the M1 session notes).
// EPUB/MOBI/AZW3/CBZ/HTML/TXT extraction isn't implemented; those jobs succeed as a no-op
// rather than failing forever on a format this will never handle.
//
// generate_thumbnail has no handler here at all, deliberately: thumbnails are captured
// client-side on first read instead (Reader.tsx's onFirstPageRendered), per §15 open
// question 2's own proposed resolution — Deno's edge runtime has no canvas to rasterize a
// PDF page into an image. upload/complete no longer enqueues that job type.
import { withSupabase } from '@supabase/server';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractEpub, identifierSuggestions } from './epub.ts';
import { provider } from '../metadata-lookup/index.ts';

interface Job {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
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

// admin: a service-role SupabaseClient (ctx.supabaseAdmin) — untyped here since this Deno
// file has no local Database type to import (see the upload function's equivalent note).
// deno-lint-ignore no-explicit-any
async function extractText(admin: any, job: Job) {
  const assetId = job.payload.asset_id as string | undefined;
  if (!assetId) throw new Error('extract_text job missing payload.asset_id');

  const { data: asset, error: assetError } = await admin.from('assets').select('*').eq('id', assetId).single();
  if (assetError || !asset) throw new Error(assetError?.message ?? 'asset not found');

  if (asset.file_format !== 'pdf' && asset.file_format !== 'epub') {
    return { skipped: true, reason: `text extraction for '${asset.file_format}' is not implemented yet` };
  }

  const { data: file, error: downloadError } = await admin.storage.from(asset.bucket).download(asset.storage_path);
  if (downloadError || !file) throw new Error(downloadError?.message ?? 'could not download asset');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const filename = typeof job.payload.filename === 'string' ? job.payload.filename : '';
  if (asset.file_format === 'epub') {
    const result = extractEpub(bytes);
    const found = identifierSuggestions(result.text, filename);
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

    // ponytail: a short preview + counts, not the full extracted text — storing an entire
    // book's text in a JSONB column doesn't scale. Wiring this into search_library() (the
    // spec's "feeds search") is a separate follow-up once there's a real column for it.
    const found = identifierSuggestions(text, filename);
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

// Background enrichment only writes a suggestion; the user still confirms every field.
// deno-lint-ignore no-explicit-any
async function fetchMetadata(admin: any, job: Job) {
  const { record_id: recordId, scheme, value } = job.payload;
  if (typeof recordId !== 'string' || (scheme !== 'isbn' && scheme !== 'doi') || typeof value !== 'string') throw new Error('invalid fetch_metadata payload');
  const { data: record, error: recordError } = await admin.from('records').select('metadata').eq('id', recordId).single();
  if (recordError || !record) throw new Error('record not found');
  const { data: cached } = await admin.from('metadata_cache').select('response_data').eq('identifier_scheme', scheme).eq('identifier_value', value).gt('expires_at', new Date().toISOString()).order('fetched_at', { ascending: false }).limit(1).maybeSingle();
  let suggestion = cached?.response_data;
  if (!suggestion) {
    const providers = scheme === 'isbn' ? ['openlibrary', ...(Deno.env.get('GOOGLE_BOOKS_API_KEY') ? ['google_books'] : [])] : ['crossref', 'semantic_scholar'];
    let failure = '';
    for (const name of providers) {
      const result = await provider(name, name === 'semantic_scholar' ? `DOI:${value}` : value);
      if (result.kind === 'success') {
        suggestion = result.data;
        const { error: cacheError } = await admin.from('metadata_cache').upsert({ identifier_scheme: scheme, identifier_value: value, provider: name, response_data: suggestion, fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }, { onConflict: 'identifier_scheme,identifier_value,provider' });
        if (cacheError) throw cacheError;
        break;
      }
      if (result.kind === 'provider_error') failure = result.message;
      if (result.kind === 'rate_limited') failure = `rate limited by ${name}`;
    }
    if (!suggestion && failure) throw new Error(failure);
  }
  if (!suggestion) return { found: false };
  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  const suggestions = (metadata.lookup_suggestions ?? {}) as Record<string, unknown>;
  const { error } = await admin.from('records').update({ metadata: { ...metadata, lookup_suggestions: { ...suggestions, [`${scheme}:${value}`]: { data: suggestion, fetched_at: new Date().toISOString() } } } }).eq('id', recordId);
  if (error) throw error;
  return { found: true };
}

// Provider covers are public bytes but enter the private, content-addressed asset store.
// deno-lint-ignore no-explicit-any
async function processCover(admin: any, job: Job) {
  const recordId = job.payload.record_id;
  const rawUrl = job.payload.url;
  if (typeof recordId !== 'string' || typeof rawUrl !== 'string') throw new Error('invalid process_cover payload');
  let url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'covers.openlibrary.org') throw new Error('cover host is not allowed');
  const { data: record, error: recordError } = await admin.from('records').select('id,works(user_id)').eq('id', recordId).single();
  if (recordError || !record) throw new Error('record not found');
  const userId = record.works?.user_id;
  if (!userId) throw new Error('record owner not found');
  let response: Response;
  for (let redirects = 0;; redirects++) {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (redirects >= 3) throw new Error('too many cover redirects');
    const location = response.headers.get('location');
    if (!location) throw new Error('cover redirect missing location');
    const next = new URL(location, url);
    if (next.protocol !== 'https:' || !(next.hostname === 'archive.org' || next.hostname.endsWith('.us.archive.org') || next.hostname === 'covers.openlibrary.org')) throw new Error('cover redirect host is not allowed');
    url = next;
  }
  if (!response.ok) throw new Error(`cover provider HTTP ${response.status}`);
  if (Number(response.headers.get('content-length') ?? 0) > 5_000_000) throw new Error('cover too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty cover response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 5_000_000) { await reader.cancel(); throw new Error('cover too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const jpg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b);
  if (!jpg && !png) throw new Error('unsupported cover bytes');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const checksum = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const path = `${userId}/${checksum}.${jpg ? 'jpg' : 'png'}`;
  const { error: storageError } = await admin.storage.from('covers').upload(path, bytes, { contentType: jpg ? 'image/jpeg' : 'image/png', upsert: true });
  if (storageError) throw storageError;
  const { data: existing } = await admin.from('assets').select('id').eq('user_id', userId).eq('checksum_sha256', checksum).maybeSingle();
  let asset = existing;
  if (!asset) {
    const { data: created, error: assetError } = await admin.from('assets').insert({ user_id: userId, bucket: 'covers', storage_path: path, file_size: bytes.length, checksum_sha256: checksum, mime_type: jpg ? 'image/jpeg' : 'image/png', file_format: 'image', processing_state: 'ready' }).select('id').single();
    if (assetError) {
      if (assetError.code !== '23505') throw assetError;
      const { data: raced, error: raceError } = await admin.from('assets').select('id').eq('user_id', userId).eq('checksum_sha256', checksum).single();
      if (raceError) throw raceError;
      asset = raced;
    } else asset = created;
  }
  const { error: linkError } = await admin.from('record_assets').upsert({ record_id: recordId, asset_id: asset.id, role: 'cover' }, { onConflict: 'record_id,asset_id,role', ignoreDuplicates: true });
  if (linkError) throw linkError;
  return { asset_id: asset.id };
}

// deno-lint-ignore no-explicit-any
const HANDLERS: Record<string, (admin: any, job: Job) => Promise<unknown>> = {
  extract_text: extractText,
  process_cover: processCover,
  fetch_metadata: fetchMetadata,
};

export default {
  fetch: withSupabase({ auth: 'secret' }, async (_req, ctx) => {
    await ctx.supabaseAdmin.rpc('expire_stale_jobs');

    const { data: jobs, error: claimError } = await ctx.supabaseAdmin.rpc('claim_jobs', { p_limit: 5 });
    if (claimError) return Response.json({ error: claimError.message }, { status: 500 });

    const results = [];
    for (const job of (jobs ?? []) as Job[]) {
      const handler = HANDLERS[job.job_type];
      try {
        if (!handler) throw new Error(`no handler for job_type '${job.job_type}'`);
        const result = await handler(ctx.supabaseAdmin, job);
        await ctx.supabaseAdmin.from('jobs').update({ status: 'succeeded', completed_at: new Date().toISOString(), result }).eq('id', job.id);
        results.push({ id: job.id, status: 'succeeded' });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`job ${job.id} (${job.job_type}) failed:`, message);
        if (job.attempts >= job.max_attempts) {
          await ctx.supabaseAdmin.from('jobs').update({ status: 'failed', completed_at: new Date().toISOString(), last_error: message }).eq('id', job.id);
          results.push({ id: job.id, status: 'failed', error: message });
        } else {
          // Left 'running' on purpose: the lease expires and claim_jobs() retries it.
          results.push({ id: job.id, status: 'retrying', error: message });
        }
      }
    }
    return Response.json({ claimed: (jobs ?? []).length, results });
  }),
};
