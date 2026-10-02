// Edge Function: upload (§8.2, §9.1). Three actions on one function, routed by the URL's
// last path segment: POST .../upload/intent, .../upload/complete and .../upload/from-url.
//
// Auth: 'user' mode (@supabase/server) — a valid caller JWT is required before this code
// runs, and CORS is added automatically (both defaults). ctx.supabase is RLS-scoped to the
// caller (used for ownership checks — a record only comes back if it's theirs). ctx.supabaseAdmin
// bypasses RLS (used for the privileged writes only the server may do — CLAUDE.md invariants 3/6).
import { withSupabase, type SupabaseContext } from '@supabase/server';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
type UploadContext = { supabase: SupabaseClient; supabaseAdmin: SupabaseClient; userId: string; agentAction?: { id: string; tokenId: string } };
import { createHash } from 'node:crypto';
import { SNIFF_HEAD_BYTES, sniff, TextProbe } from '../_shared/sniff.ts';
import { parsePublicUrl } from '../_shared/publicUrl.ts';
import { fetchPublic } from '../_shared/fetchPublic.ts';
import { jsonBody, rateLimit } from '../_shared/limits.ts';
import { deadline, checked, withBudget } from '../_shared/budget.ts';

const MAX_UPLOAD_SIZE = 524_288_000; // 500 MB — documents/staging bucket limit (§7.4)

const DOCUMENT_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'application/x-mobipocket-ebook': 'mobi',
  'application/vnd.amazon.ebook': 'azw3',
  'application/vnd.comicbook+zip': 'cbz',
  'image/vnd.djvu': 'djvu',
  'text/html': 'html',
  'text/plain': 'txt',
};
const COVER_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const IntentSchema = z.object({
  uploadId: z.string().uuid(),
  recordId: z.string().uuid(),
  // Never interpolated into a storage path (see handleIntent) — kept validated anyway as
  // defense in depth against that constraint being lost in a future edit. Path traversal
  // (security review, 2026-09-28): a raw client filename in a storage key lets a caller write
  // outside their own {userId}/{uploadId}/ prefix via "../" segments.
  filename: z.string().min(1).max(255).refine((n) => !n.includes('/') && !n.includes('\\') && n !== '.' && n !== '..'),
  size: z.number().int().positive(),
});

const CompleteSchema = z.object({
  uploadId: z.string().uuid(),
  recordId: z.string().uuid(),
  role: z.enum(['primary', 'supplement', 'cover']),
  filename: z.string().min(1).max(255).refine((n) => !n.includes('/') && !n.includes('\\')).optional(),
});

const FromUrlSchema = z.object({
  uploadId: z.string().uuid(),
  recordId: z.string().uuid(),
  role: z.enum(['primary', 'supplement', 'cover']),
  url: z.string().max(2048),
});

async function assertRecordOwner(ctx: UploadContext, recordId: string): Promise<boolean> {
  // RLS-scoped client: a row comes back only if this record belongs to the caller.
  const { data, error } = await ctx.supabase.from('records').select('id').eq('id', recordId).maybeSingle();
  if (error) throw error;
  return !!data;
}

class TooLarge extends Error {}

type Staged = { kind: 'ok'; size: number; checksum: string; mimeType: string | null } | { kind: 'missing' } | { kind: 'empty_or_large' };

// One streaming pass over a staged object: SHA-256, size, and the type from its bytes (invariant 6). Memory stays
// constant however large the file is (§15 #1): chunks flow through the hash and are only glanced at, never kept
// beyond the first SNIFF_HEAD_BYTES.
async function inspectStaged(ctx: UploadContext, stagingPath: string, signal: AbortSignal): Promise<Staged> {
  const { data: signed } = await ctx.supabaseAdmin.storage.from('staging').createSignedUrl(stagingPath, 300);
  if (!signed) return { kind: 'missing' };
  const res = await fetch(signed.signedUrl, { signal: signal });
  if (!res.ok || !res.body) return { kind: 'missing' };

  const head = new Uint8Array(SNIFF_HEAD_BYTES);
  const probe = new TextProbe();
  let size = 0;
  let filled = 0;
  const hash = createHash('sha256');
  async function observe(body: ReadableStream<Uint8Array<ArrayBuffer>>) {
    for await (const chunk of body) {
      size += chunk.length;
      if (size > MAX_UPLOAD_SIZE) throw new TooLarge();
      if (filled < head.length) {
        const n = Math.min(chunk.length, head.length - filled);
        head.set(chunk.subarray(0, n), filled);
        filled += n;
      }
      probe.push(chunk);
      hash.update(chunk);
    }
  }
  try {
    await observe(res.body);
    if (size === 0) return { kind: 'empty_or_large' };
    return { kind: 'ok', size, checksum: hash.digest('hex'), mimeType: sniff(head.subarray(0, filled), probe)?.mimeType ?? null };
  } catch (e) {
    if (e instanceof TooLarge) return { kind: 'empty_or_large' };
    throw e;
  }
}

// Copies staging -> final path as a stream, stamping the *sniffed* content type on the stored object (a server-side
// storage copy would keep the client's declared type). The path is content-addressed, so an existing object already
// holds these exact bytes and is left alone; a signed upload URL avoids handling the service key here.
async function publishStaged(ctx: UploadContext, stagingPath: string, bucket: string, destPath: string, mimeType: string, size: number, signal: AbortSignal): Promise<string | null> {
  const { data: exists } = await ctx.supabaseAdmin.storage.from(bucket).exists(destPath);
  if (exists) return null;
  const { data: source } = await ctx.supabaseAdmin.storage.from('staging').createSignedUrl(stagingPath, 300);
  const { data: target, error } = await ctx.supabaseAdmin.storage.from(bucket).createSignedUploadUrl(destPath);
  if (!source || error || !target) return error?.message ?? 'could not prepare the copy';
  const res = await fetch(source.signedUrl, { signal: signal });
  if (!res.ok || !res.body) return 'could not read the staged file';
  const put = await fetch(target.signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType, 'Content-Length': String(size), 'x-upsert': 'false' },
    body: res.body,
    // @ts-expect-error `duplex` is required to stream a request body but is missing from the DOM typings
    duplex: 'half',
    signal: signal,
  });
  if (put.ok) return null;
  // A concurrent publisher may win; only immutable existing bytes count as success.
  const { data: raced } = await ctx.supabaseAdmin.storage.from(bucket).exists(destPath);
  return raced ? null : `storage returned ${put.status}`;
}

async function handleIntent(req: Request, ctx: UploadContext): Promise<Response> {
  const parsed = IntentSchema.safeParse(await jsonBody(req));
  if (!parsed.success) return Response.json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });
  const { uploadId, recordId, size, filename } = parsed.data;

  if (!(await assertRecordOwner(ctx, recordId))) return Response.json({ error: 'not_found' }, { status: 404 });
  if (size > MAX_UPLOAD_SIZE) return Response.json({ error: 'file_too_large', limit: MAX_UPLOAD_SIZE }, { status: 400 });

  await checked(ctx.supabaseAdmin.rpc('begin_upload', { p_user: ctx.userId, p_id: uploadId, p_record: recordId, p_intent: { filename, size, source: 'file' } }));

  // uploadId (a validated UUID) already makes this path unique per upload attempt; the
  // client's filename plays no role in it (see the schema comment above) — nothing downstream
  // reads the staging object's name back (handleComplete lists the folder and uses whatever
  // name storage reports), and the final destination's extension comes from magic-byte
  // sniffing, not from this filename.
  const path = `${ctx.userId}/${uploadId}/upload`;
  const { data, error } = await ctx.supabaseAdmin.storage.from('staging').createSignedUploadUrl(path);
  if (error) return Response.json({ error: 'storage_error', message: error.message }, { status: 500 });

  return Response.json({ path: data.path, token: data.token });
}

async function handleComplete(req: Request, ctx: UploadContext, signal: AbortSignal): Promise<Response> {
  const parsed = CompleteSchema.safeParse(await jsonBody(req));
  if (!parsed.success) return Response.json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });
  if (!(await assertRecordOwner(ctx, parsed.data.recordId))) return Response.json({ error: 'not_found' }, { status: 404 });
  return completeStaged(ctx, parsed.data, signal);
}

// Everything after the bytes are in staging (§9.1): verify, publish, asset, link, jobs. Shared by complete and from-url.
export async function completeStaged(ctx: UploadContext, { uploadId, recordId, role, filename }: z.infer<typeof CompleteSchema>, signal: AbortSignal): Promise<Response> {
  const userId = ctx.userId;
  const request = { role, filename: filename ?? '' };
  const attempt = await checked(ctx.supabaseAdmin.from('upload_attempts').select('record_id,request,result').eq('user_id', userId).eq('id', uploadId).maybeSingle());
  if (!attempt || attempt.record_id !== recordId) return Response.json({ error: 'upload_intent_missing' }, { status: 409 });
  if (attempt.request && JSON.stringify(attempt.request) !== JSON.stringify(request)) {
    // JSONB key order is not significant.
    const stored = attempt.request as { role: string; filename: string };
    if (stored.role !== role || stored.filename !== request.filename) return Response.json({ error: 'upload_request_changed' }, { status: 409 });
  }
  if (attempt.result) return Response.json(attempt.result);

  const folder = `${userId}/${uploadId}`;
  const stagingPath = `${folder}/frozen`;
  const { data: frozen } = await ctx.supabaseAdmin.storage.from('staging').exists(stagingPath);
  if (!frozen) {
    // Only /upload was signed for client writes. Moving to /frozen makes both verification
    // and copying read the same immutable object, even if the old signed URL is reused.
    const { error } = await ctx.supabaseAdmin.storage.from('staging').move(`${folder}/upload`, stagingPath);
    if (error) {
      const { data: raced } = await ctx.supabaseAdmin.storage.from('staging').exists(stagingPath);
      if (!raced) return Response.json({ status: 'rejected', reason: 'missing' });
    }
  }
  const staged = await inspectStaged(ctx, stagingPath, signal);
  if (staged.kind !== 'ok') return Response.json({ status: 'rejected', reason: staged.kind === 'missing' ? 'missing' : 'size_mismatch' });
  const isCover = role === 'cover';
  const allowed = isCover ? COVER_MIME_TYPES : DOCUMENT_MIME_TYPES;
  if (!staged.mimeType || !(staged.mimeType in allowed)) return Response.json({ status: 'rejected', reason: 'unsupported_type' });
  if (isCover && staged.size > 5_242_880) return Response.json({ status: 'rejected', reason: 'size_mismatch' });
  const bucket = isCover ? 'covers' : 'documents';
  const ext = allowed[staged.mimeType];
  const destPath = `${userId}/${staged.checksum}.${ext}`;
  const publishError = await publishStaged(ctx, stagingPath, bucket, destPath, staged.mimeType, staged.size, signal);
  if (publishError) return Response.json({ error: 'storage_error' }, { status: 500 });
  const result = await checked(ctx.supabaseAdmin.rpc(ctx.agentAction ? 'complete_agent_upload' : 'complete_upload', {
    ...(ctx.agentAction ? { p_action: ctx.agentAction.id, p_token: ctx.agentAction.tokenId } : { p_user: userId, p_id: uploadId }), p_request: request,
    p_asset: { bucket, storage_path: destPath, file_size: staged.size, checksum_sha256: staged.checksum,
      mime_type: staged.mimeType, file_format: isCover ? 'image' : ext, processing_state: isCover ? 'ready' : 'pending' },
  }).setHeader('x-textus-actor', ctx.agentAction ? `agent:${ctx.agentAction.tokenId}` : 'user')); // book history: whose upload this is
  // Completion is durable before staging is removed; failures here are handled by cleanup.
  await ctx.supabaseAdmin.storage.from('staging').remove([stagingPath, `${folder}/upload`]);
  return Response.json(result);
}

// Name for identifier suggestions only (as complete's `filename`); never used in a storage path.
function filenameFromUrl(url: string): string | undefined {
  const last = new URL(url).pathname.split('/').filter(Boolean).at(-1);
  try {
    const name = last && decodeURIComponent(last).replace(/[/\\]/g, ' ').slice(0, 255);
    return name && name !== '.' && name !== '..' ? name : undefined;
  } catch {
    return undefined;
  }
}

// "Add via link": the server downloads the file into the same staging path an intent would have issued, then finishes
// exactly like complete. Size is enforced by the staging bucket's 500 MB limit while streaming (§7.4), plus an early
// Content-Length check.
export async function handleFromUrl(req: Request, ctx: UploadContext, signal: AbortSignal): Promise<Response> {
  const parsed = FromUrlSchema.safeParse(await jsonBody(req));
  if (!parsed.success) return Response.json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });
  const { uploadId, recordId, role, url } = parsed.data;
  if (!parsePublicUrl(url)) return Response.json({ error: 'invalid_url' }, { status: 400 });
  if (!(await assertRecordOwner(ctx, recordId))) return Response.json({ error: 'not_found' }, { status: 404 });

  const replay = await checked(ctx.supabaseAdmin.rpc('begin_upload', { p_user: ctx.userId, p_id: uploadId, p_record: recordId, p_intent: { url, role, source: 'url' } }));
  if (replay) return Response.json(replay);
  const { data: frozen } = await ctx.supabaseAdmin.storage.from('staging').exists(`${ctx.userId}/${uploadId}/frozen`);
  if (frozen) return completeStaged(ctx, { uploadId, recordId, role, filename: filenameFromUrl(url) }, signal);
  const path = `${ctx.userId}/${uploadId}/upload`;
  try {
    const res = await fetchPublic(url, signal);
    if (!res?.ok || !res.body) {
      await res?.body?.cancel();
      return Response.json({ status: 'rejected', reason: 'unreachable' });
    }
    const length = res.headers.get('content-length');
    if (Number(length ?? 0) > MAX_UPLOAD_SIZE) {
      await res.body.cancel();
      return Response.json({ status: 'rejected', reason: 'size_mismatch' });
    }
    const { data: target, error } = await ctx.supabaseAdmin.storage.from('staging').createSignedUploadUrl(path);
    if (error || !target) return Response.json({ error: 'storage_error' }, { status: 500 });
    const put = await fetch(target.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'false', ...(length ? { 'Content-Length': length } : {}) },
      body: res.body,
      // @ts-expect-error `duplex` is required to stream a request body but is missing from the DOM typings
      duplex: 'half',
      signal,
    });
    if (!put.ok) {
      console.error('upload: could not stage the linked file', put.status);
      return Response.json({ status: 'rejected', reason: put.status === 413 ? 'size_mismatch' : 'unreachable' });
    }
  } catch (e) {
    console.error('upload: public download failed', e instanceof Error ? e.name : 'Error');
    return Response.json({ status: 'rejected', reason: 'unreachable' });
  }
  return completeStaged(ctx, { uploadId, recordId, role, filename: filenameFromUrl(url) }, signal);
}

export default {
  // async is required by withSupabase's handler type (Promise<Response>, not Response |
  // Promise<Response>) — this function has no internal await since it just dispatches to
  // the handle* functions above, which are themselves async.
  fetch: withSupabase({ auth: 'user' }, withBudget(async (req: Request, serverContext: SupabaseContext) => {
    const ctx: UploadContext = { ...serverContext, userId: serverContext.userClaims!.id };
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    await rateLimit(ctx.supabaseAdmin, `upload:${ctx.userId}`, 20);
    const signal = deadline();
    const { pathname } = new URL(req.url);
    if (pathname.endsWith('/intent')) return handleIntent(req, ctx);
    if (pathname.endsWith('/complete')) return handleComplete(req, ctx, signal);
    if (pathname.endsWith('/from-url')) return handleFromUrl(req, ctx, signal);
    return new Response('Not found', { status: 404 });
  })),
};
