// Edge Function: upload (§8.2, §9.1). Two actions on one function, routed by the URL's
// last path segment: POST .../upload/intent and POST .../upload/complete.
//
// Auth: 'user' mode (@supabase/server) — a valid caller JWT is required before this code
// runs, and CORS is added automatically (both defaults). ctx.supabase is RLS-scoped to the
// caller (used for ownership checks — a record only comes back if it's theirs). ctx.supabaseAdmin
// bypasses RLS (used for the privileged writes only the server may do — CLAUDE.md invariants 3/6).
import { withSupabase, type SupabaseContext } from '@supabase/server';
import { z } from 'zod';

const MAX_UPLOAD_SIZE = 524_288_000; // 500 MB — documents/staging bucket limit (§7.4)

const DOCUMENT_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'application/x-mobipocket-ebook': 'mobi',
  'application/vnd.amazon.ebook': 'azw3',
  'application/vnd.comicbook+zip': 'cbz',
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
});

// Magic-byte sniffing (CLAUDE.md invariant 6: never trust the client's declared MIME type).
// ponytail: MOBI and AZW3 share the same PalmDB "BOOKMOBI" container signature — telling them
// apart needs parsing the EXTH header, not just the magic bytes. Every valid PalmDB ebook is
// classified 'mobi' here; upgrade to real EXTH parsing if AZW3 mislabeling matters in practice.
// ponytail: CBZ has no internal magic beyond "it's a zip that isn't an EPUB" — any non-EPUB
// zip is accepted as CBZ. Real validation would open the archive and check for image entries.
function sniffFileFormat(bytes: Uint8Array): { mimeType: string } | null {
  const startsWith = (sig: number[]) => sig.length <= bytes.length && sig.every((b, i) => bytes[i] === b);
  const latin1 = (start: number, end: number) => new TextDecoder('latin1').decode(bytes.slice(start, end));

  if (startsWith([0x25, 0x50, 0x44, 0x46])) return { mimeType: 'application/pdf' }; // %PDF
  if (startsWith([0xff, 0xd8, 0xff])) return { mimeType: 'image/jpeg' };
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mimeType: 'image/png' };
  if (latin1(0, 4) === 'RIFF' && latin1(8, 12) === 'WEBP') return { mimeType: 'image/webp' };

  if (startsWith([0x50, 0x4b, 0x03, 0x04]) || startsWith([0x50, 0x4b, 0x05, 0x06])) {
    // EPUB's first (stored, uncompressed) zip entry is a file named "mimetype" containing
    // "application/epub+zip". A cheap substring scan of the header avoids a full zip parse.
    if (latin1(0, 128).includes('mimetypeapplication/epub+zip')) return { mimeType: 'application/epub+zip' };
    return { mimeType: 'application/vnd.comicbook+zip' };
  }

  if (bytes.length > 68 && latin1(60, 68) === 'BOOKMOBI') return { mimeType: 'application/x-mobipocket-ebook' };

  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return { mimeType: 'text/html' };

  // ponytail: no magic bytes exist for plain text. Accept only if the whole file decodes as
  // valid UTF-8 with no control bytes outside common whitespace.
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    const text = decoder.decode(bytes);
    // deno-lint-ignore no-control-regex
    if (!/[\x00-\x08\x0e-\x1f]/.test(text)) return { mimeType: 'text/plain' };
  } catch {
    /* not valid UTF-8 */
  }
  return null;
}

async function assertRecordOwner(ctx: SupabaseContext, recordId: string): Promise<boolean> {
  // RLS-scoped client: a row comes back only if this record belongs to the caller.
  const { data, error } = await ctx.supabase.from('records').select('id').eq('id', recordId).maybeSingle();
  if (error) throw error;
  return !!data;
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

async function handleComplete(req: Request, ctx: SupabaseContext): Promise<Response> {
  const parsed = CompleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });
  const { uploadId, recordId, role } = parsed.data;
  const userId = ctx.userClaims!.id;

  if (!(await assertRecordOwner(ctx, recordId))) return Response.json({ error: 'not_found' }, { status: 404 });

  const folder = `${userId}/${uploadId}`;
  const { data: listing, error: listError } = await ctx.supabaseAdmin.storage.from('staging').list(folder);
  if (listError) return Response.json({ error: 'storage_error', message: listError.message }, { status: 500 });
  const staged = listing?.[0];
  if (!staged) return Response.json({ status: 'rejected', reason: 'missing' });

  const stagingPath = `${folder}/${staged.name}`;
  const { data: blob, error: downloadError } = await ctx.supabaseAdmin.storage.from('staging').download(stagingPath);
  if (downloadError || !blob) return Response.json({ status: 'rejected', reason: 'missing' });

  const bytes = new Uint8Array(await blob.arrayBuffer());
  // No upload-sessions table records the size declared at intent time (§14 deviation #7), so
  // this re-checks the actual bytes against the bucket limit rather than a stored expectation.
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD_SIZE) {
    await ctx.supabaseAdmin.storage.from('staging').remove([stagingPath]);
    return Response.json({ status: 'rejected', reason: 'size_mismatch' });
  }

  const isCover = role === 'cover';
  const allowed = isCover ? COVER_MIME_TYPES : DOCUMENT_MIME_TYPES;
  const sniffed = sniffFileFormat(bytes);
  if (!sniffed || !(sniffed.mimeType in allowed)) {
    await ctx.supabaseAdmin.storage.from('staging').remove([stagingPath]);
    return Response.json({ status: 'rejected', reason: 'unsupported_type' });
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const checksum = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const bucket = isCover ? 'covers' : 'documents';
  const ext = allowed[sniffed.mimeType];
  const destPath = `${userId}/${checksum}.${ext}`;

  // Content-addressed destination: identical bytes always land on the same path, so
  // overwriting it with the same content is safe and makes this step idempotent.
  const { error: copyError } = await ctx.supabaseAdmin.storage
    .from(bucket)
    .upload(destPath, bytes, { contentType: sniffed.mimeType, upsert: true });
  if (copyError) return Response.json({ error: 'storage_error', message: copyError.message }, { status: 500 });

  const fileFormat = isCover ? 'image' : ext;

  const { data: existing } = await ctx.supabaseAdmin
    .from('assets')
    .select('*')
    .eq('user_id', userId)
    .eq('checksum_sha256', checksum)
    .maybeSingle();

  let asset = existing;
  let deduplicated = !!existing;
  if (!asset) {
    const { data: inserted, error: insertError } = await ctx.supabaseAdmin
      .from('assets')
      .insert({
        user_id: userId,
        bucket,
        storage_path: destPath,
        file_size: bytes.length,
        checksum_sha256: checksum,
        mime_type: sniffed.mimeType,
        file_format: fileFormat,
        processing_state: isCover ? 'ready' : 'pending',
      })
      .select('*')
      .single();
    if (insertError?.code === '23505') {
      const { data: raced } = await ctx.supabaseAdmin
        .from('assets')
        .select('*')
        .eq('user_id', userId)
        .eq('checksum_sha256', checksum)
        .single();
      asset = raced;
      deduplicated = true;
    } else if (insertError) {
      return Response.json({ error: 'db_error', message: insertError.message }, { status: 500 });
    } else {
      asset = inserted;
    }
  }

  await ctx.supabaseAdmin
    .from('record_assets')
    .upsert({ record_id: recordId, asset_id: asset!.id, role }, { onConflict: 'record_id,asset_id,role', ignoreDuplicates: true });

  // generate_thumbnail is deliberately not enqueued: thumbnails are captured client-side on
  // first read instead (Reader.tsx), per §15 Q2 — see job-worker's own note on why.
  if (!isCover) {
    await ctx.supabaseAdmin
      .from('jobs')
      .upsert(
        { user_id: userId, job_type: 'extract_text', payload: { asset_id: asset!.id }, idempotency_key: `extract_text:${asset!.id}` },
        { onConflict: 'idempotency_key', ignoreDuplicates: true },
      );
  }

  await ctx.supabaseAdmin.storage.from('staging').remove([stagingPath]);

  return Response.json({ status: deduplicated ? 'deduplicated' : 'created', asset });
}

export default {
  // async is required by withSupabase's handler type (Promise<Response>, not Response |
  // Promise<Response>) — this function has no internal await since it just dispatches to
  // handleIntent/handleComplete, which are themselves async.
  // deno-lint-ignore require-await
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const { pathname } = new URL(req.url);
    if (pathname.endsWith('/intent')) return handleIntent(req, ctx);
    if (pathname.endsWith('/complete')) return handleComplete(req, ctx);
    return new Response('Not found', { status: 404 });
  }),
};
