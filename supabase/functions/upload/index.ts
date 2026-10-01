// Edge Function: upload (§8.2, §9.1). Three actions on one function, routed by the URL's
// last path segment: POST .../upload/intent, .../upload/complete and .../upload/from-url.
//
// Auth: 'user' mode (@supabase/server) — a valid caller JWT is required before this code
// runs, and CORS is added automatically (both defaults). ctx.supabase is RLS-scoped to the
// caller (used for ownership checks — a record only comes back if it's theirs). ctx.supabaseAdmin
// bypasses RLS (used for the privileged writes only the server may do — CLAUDE.md invariants 3/6).
import { withSupabase, type SupabaseContext } from '@supabase/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { SNIFF_HEAD_BYTES, sniff, TextProbe } from '../_shared/sniff.ts';
import { isIpLiteral, isPublicIp, parsePublicUrl } from '../_shared/publicUrl.ts';

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

async function assertRecordOwner(ctx: SupabaseContext, recordId: string): Promise<boolean> {
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
async function inspectStaged(ctx: SupabaseContext, stagingPath: string): Promise<Staged> {
  const { data: signed } = await ctx.supabaseAdmin.storage.from('staging').createSignedUrl(stagingPath, 300);
  if (!signed) return { kind: 'missing' };
  const res = await fetch(signed.signedUrl, { signal: AbortSignal.timeout(300_000) });
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
async function publishStaged(ctx: SupabaseContext, stagingPath: string, bucket: string, destPath: string, mimeType: string, size: number): Promise<string | null> {
  const { data: exists } = await ctx.supabaseAdmin.storage.from(bucket).exists(destPath);
  if (exists) return null;
  const { data: source } = await ctx.supabaseAdmin.storage.from('staging').createSignedUrl(stagingPath, 300);
  const { data: target, error } = await ctx.supabaseAdmin.storage.from(bucket).createSignedUploadUrl(destPath, { upsert: true });
  if (!source || error || !target) return error?.message ?? 'could not prepare the copy';
  const res = await fetch(source.signedUrl, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok || !res.body) return 'could not read the staged file';
  const put = await fetch(target.signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType, 'Content-Length': String(size), 'x-upsert': 'true' },
    body: res.body,
    // @ts-expect-error `duplex` is required to stream a request body but is missing from the DOM typings
    duplex: 'half',
    signal: AbortSignal.timeout(300_000),
  });
  return put.ok ? null : `storage returned ${put.status}`;
}

async function handleIntent(req: Request, ctx: SupabaseContext): Promise<Response> {
  const parsed = IntentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });
  const { uploadId, recordId, size } = parsed.data;

  if (!(await assertRecordOwner(ctx, recordId))) return Response.json({ error: 'not_found' }, { status: 404 });
  if (size > MAX_UPLOAD_SIZE) return Response.json({ error: 'file_too_large', limit: MAX_UPLOAD_SIZE }, { status: 400 });

  // uploadId (a validated UUID) already makes this path unique per upload attempt; the
  // client's filename plays no role in it (see the schema comment above) — nothing downstream
  // reads the staging object's name back (handleComplete lists the folder and uses whatever
  // name storage reports), and the final destination's extension comes from magic-byte
  // sniffing, not from this filename.
  const path = `${ctx.userClaims!.id}/${uploadId}/upload`;
  const { data, error } = await ctx.supabaseAdmin.storage.from('staging').createSignedUploadUrl(path);
  if (error) return Response.json({ error: 'storage_error', message: error.message }, { status: 500 });

  return Response.json({ path: data.path, token: data.token });
}

interface NewAsset {
  userId: string;
  bucket: string;
  destPath: string;
  size: number;
  checksum: string;
  mimeType: string;
  fileFormat: string;
  processingState: 'ready' | 'pending';
}

// ON CONFLICT semantics by hand: the same bytes for the same user are one asset (UNIQUE
// (user_id, checksum_sha256)). A concurrent insert that loses the race reads the winner's row.
async function findOrCreateAsset(ctx: SupabaseContext, a: NewAsset) {
  const { data: existing } = await ctx.supabaseAdmin.from('assets').select('*').eq('user_id', a.userId).eq('checksum_sha256', a.checksum).maybeSingle();
  if (existing) return { asset: existing, deduplicated: true };

  const { data: inserted, error: insertError } = await ctx.supabaseAdmin
    .from('assets')
    .insert({
      user_id: a.userId,
      bucket: a.bucket,
      storage_path: a.destPath,
      file_size: a.size,
      checksum_sha256: a.checksum,
      mime_type: a.mimeType,
      file_format: a.fileFormat,
      processing_state: a.processingState,
    })
    .select('*')
    .single();
  if (!insertError) return { asset: inserted, deduplicated: false };
  if (insertError.code !== '23505') return Response.json({ error: 'db_error', message: insertError.message }, { status: 500 });

  const { data: raced } = await ctx.supabaseAdmin.from('assets').select('*').eq('user_id', a.userId).eq('checksum_sha256', a.checksum).single();
  return { asset: raced!, deduplicated: true };
}

async function handleComplete(req: Request, ctx: SupabaseContext): Promise<Response> {
  const parsed = CompleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });
  if (!(await assertRecordOwner(ctx, parsed.data.recordId))) return Response.json({ error: 'not_found' }, { status: 404 });
  return completeStaged(ctx, parsed.data);
}

// Everything after the bytes are in staging (§9.1): verify, publish, asset, link, jobs. Shared by complete and from-url.
async function completeStaged(ctx: SupabaseContext, { uploadId, recordId, role, filename }: z.infer<typeof CompleteSchema>): Promise<Response> {
  const userId = ctx.userClaims!.id;
  const folder = `${userId}/${uploadId}`;
  const { data: listing, error: listError } = await ctx.supabaseAdmin.storage.from('staging').list(folder);
  if (listError) return Response.json({ error: 'storage_error', message: listError.message }, { status: 500 });
  const stagedFile = listing?.[0];
  if (!stagedFile) return Response.json({ status: 'rejected', reason: 'missing' });

  const stagingPath = `${folder}/${stagedFile.name}`;
  const staged = await inspectStaged(ctx, stagingPath);
  if (staged.kind === 'missing') return Response.json({ status: 'rejected', reason: 'missing' });
  // No upload-sessions table records the size declared at intent time (§14 deviation #7), so this checks the
  // actual bytes against the bucket limit rather than a stored expectation.
  if (staged.kind === 'empty_or_large') {
    await ctx.supabaseAdmin.storage.from('staging').remove([stagingPath]);
    return Response.json({ status: 'rejected', reason: 'size_mismatch' });
  }

  const isCover = role === 'cover';
  const allowed = isCover ? COVER_MIME_TYPES : DOCUMENT_MIME_TYPES;
  if (!staged.mimeType || !(staged.mimeType in allowed)) {
    await ctx.supabaseAdmin.storage.from('staging').remove([stagingPath]);
    return Response.json({ status: 'rejected', reason: 'unsupported_type' });
  }
  const sniffed = { mimeType: staged.mimeType };
  const checksum = staged.checksum;
  const bucket = isCover ? 'covers' : 'documents';
  const ext = allowed[sniffed.mimeType];
  const destPath = `${userId}/${checksum}.${ext}`;

  // Content-addressed destination: identical bytes always land on the same path, so publishing is idempotent.
  const publishError = await publishStaged(ctx, stagingPath, bucket, destPath, sniffed.mimeType, staged.size);
  if (publishError) {
    console.error('upload: could not publish the staged file', publishError); // technical detail stays server-side
    return Response.json({ error: 'storage_error' }, { status: 500 });
  }

  const fileFormat = isCover ? 'image' : ext;

  const outcome = await findOrCreateAsset(ctx, {
    userId,
    bucket,
    destPath,
    size: staged.size,
    checksum,
    mimeType: sniffed.mimeType,
    fileFormat,
    processingState: isCover ? 'ready' : 'pending',
  });
  if (outcome instanceof Response) return outcome;
  const { asset, deduplicated } = outcome;

  await ctx.supabaseAdmin
    .from('record_assets')
    .upsert({ record_id: recordId, asset_id: asset.id, role }, { onConflict: 'record_id,asset_id,role', ignoreDuplicates: true });

  // generate_thumbnail is deliberately not enqueued: thumbnails are captured client-side on
  // first read instead (Reader.tsx), per §15 Q2 — see job-worker's own note on why.
  if (!isCover) {
    await ctx.supabaseAdmin
      .from('jobs')
      .upsert(
        { user_id: userId, job_type: 'extract_text', payload: { asset_id: asset.id, filename: filename ?? '' }, idempotency_key: `extract_text:${asset.id}` },
        { onConflict: 'idempotency_key', ignoreDuplicates: true },
      );
  }

  await ctx.supabaseAdmin.storage.from('staging').remove([stagingPath]);

  return Response.json({ status: deduplicated ? 'deduplicated' : 'created', asset });
}

// Follows redirects by hand so every hop's host and DNS answers are checked (SSRF guard, _shared/publicUrl.ts).
// ponytail: DNS is resolved again by fetch, so a rebinding resolver could still swap in a private address between
// check and connect; pin the checked address (Deno.HttpClient with a custom resolver) if that becomes a concern.
async function fetchPublic(raw: string, signal: AbortSignal): Promise<Response | null> {
  let target = raw;
  for (let hop = 0; hop <= 5; hop++) {
    const url = parsePublicUrl(target);
    if (!url) return null;
    if (!isIpLiteral(url.hostname)) {
      const answers = (await Promise.all((['A', 'AAAA'] as const).map((type) => Deno.resolveDns(url.hostname, type).catch(() => [] as string[])))).flat();
      if (!answers.length || !answers.every(isPublicIp)) return null;
    }
    const res = await fetch(url, { redirect: 'manual', signal, headers: { Accept: 'application/pdf, application/epub+zip, */*;q=0.5' } });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.body?.cancel();
    target = new URL(location, url).href;
  }
  return null;
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
async function handleFromUrl(req: Request, ctx: SupabaseContext): Promise<Response> {
  const parsed = FromUrlSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });
  const { uploadId, recordId, role, url } = parsed.data;
  if (!parsePublicUrl(url)) return Response.json({ error: 'invalid_url' }, { status: 400 });
  if (!(await assertRecordOwner(ctx, recordId))) return Response.json({ error: 'not_found' }, { status: 404 });

  const signal = AbortSignal.timeout(300_000);
  const path = `${ctx.userClaims!.id}/${uploadId}/upload`;
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
    const { data: target, error } = await ctx.supabaseAdmin.storage.from('staging').createSignedUploadUrl(path, { upsert: true });
    if (error || !target) return Response.json({ error: 'storage_error' }, { status: 500 });
    const put = await fetch(target.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true', ...(length ? { 'Content-Length': length } : {}) },
      body: res.body,
      // @ts-expect-error `duplex` is required to stream a request body but is missing from the DOM typings
      duplex: 'half',
      signal,
    });
    if (!put.ok) {
      console.error('upload: could not stage the linked file', put.status, await put.text());
      return Response.json({ status: 'rejected', reason: put.status === 413 ? 'size_mismatch' : 'unreachable' });
    }
  } catch (e) {
    console.error('upload: could not download the linked file', e);
    return Response.json({ status: 'rejected', reason: 'unreachable' });
  }
  return completeStaged(ctx, { uploadId, recordId, role, filename: filenameFromUrl(url) });
}

export default {
  // async is required by withSupabase's handler type (Promise<Response>, not Response |
  // Promise<Response>) — this function has no internal await since it just dispatches to
  // the handle* functions above, which are themselves async.
  // deno-lint-ignore require-await
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const { pathname } = new URL(req.url);
    if (pathname.endsWith('/intent')) return handleIntent(req, ctx);
    if (pathname.endsWith('/complete')) return handleComplete(req, ctx);
    if (pathname.endsWith('/from-url')) return handleFromUrl(req, ctx);
    return new Response('Not found', { status: 404 });
  }),
};
