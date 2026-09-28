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
import * as pdfjsLib from 'npm:pdfjs-dist@6.3.289/legacy/build/pdf.mjs';

interface Job {
  id: string;
  job_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

// admin: a service-role SupabaseClient (ctx.supabaseAdmin) — untyped here since this Deno
// file has no local Database type to import (see the upload function's equivalent note).
// deno-lint-ignore no-explicit-any
async function extractText(admin: any, job: Job) {
  const assetId = job.payload.asset_id as string | undefined;
  if (!assetId) throw new Error('extract_text job missing payload.asset_id');

  const { data: asset, error: assetError } = await admin.from('assets').select('*').eq('id', assetId).single();
  if (assetError || !asset) throw new Error(assetError?.message ?? 'asset not found');

  if (asset.file_format !== 'pdf') {
    return { skipped: true, reason: `text extraction for '${asset.file_format}' is not implemented yet` };
  }

  const { data: file, error: downloadError } = await admin.storage.from(asset.bucket).download(asset.storage_path);
  if (downloadError || !file) throw new Error(downloadError?.message ?? 'could not download asset');
  const bytes = new Uint8Array(await file.arrayBuffer());

  const task = pdfjsLib.getDocument({ data: bytes, disableWorker: true, isEvalSupported: false });
  const doc = await task.promise;
  try {
    const pagesToScan = Math.min(doc.numPages, 8);
    let text = '';
    for (let i = 1; i <= pagesToScan; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item: { str?: string }) => item.str ?? '').join(' ') + '\n';
    }

    // ponytail: a short preview + counts, not the full extracted text — storing an entire
    // book's text in a JSONB column doesn't scale. Wiring this into search_library() (the
    // spec's "feeds search") is a separate follow-up once there's a real column for it.
    const { error: updateError } = await admin
      .from('assets')
      .update({
        metadata: { ...((asset.metadata as object) ?? {}), page_count: doc.numPages, text_char_count: text.length, text_preview: text.slice(0, 2000) },
        processing_state: 'ready',
      })
      .eq('id', assetId);
    if (updateError) throw updateError;

    return { pageCount: doc.numPages, textCharCount: text.length };
  } finally {
    await task.destroy();
  }
}

// deno-lint-ignore no-explicit-any
const HANDLERS: Record<string, (admin: any, job: Job) => Promise<unknown>> = {
  extract_text: extractText,
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
