// Edge Function: opds (§8.5, FR-SER-3). An OPDS 1.2 catalog for e-reader apps.
//
// E-readers cannot send a Supabase JWT, so this function does its own auth (`auth: 'none'`; the
// platform JWT check is off in config.toml): HTTP Basic with the account's email + password,
// exchanged for a session on the request-scoped anon client. Every query afterwards runs as that
// user under RLS, and no service-role client is used. Accounts that only use magic-link sign-in
// have no password and cannot use this feed.
//
// Files stay private (invariant 7): entries link to /opds/download/{assetId}, which
// re-authenticates and redirects to a fresh 300 s signed URL.
import { withSupabase } from '@supabase/server';
import { buildFeed, type OpdsEntry } from '../_shared/opds.ts';

const PAGE_SIZE = 100;
const FEED_TYPE = 'application/atom+xml;profile=opds-catalog;kind=acquisition;charset=utf-8';
const BYLINE_ROLES = ['author', 'editor', 'compiler', 'translator']; // FR-CONTRIB-4 fallback order

const SELECT = `id, title, updated_at, publisher, publication_date,
  works ( title, language ),
  identifiers ( scheme, normalized_value ),
  record_contributors ( role, position, contributors ( display_name ) ),
  record_assets ( role, assets ( id, mime_type, file_size, file_format ) )`;

interface Row {
  id: string;
  title: string | null;
  updated_at: string | null;
  publisher: string | null;
  publication_date: string | null;
  works: { title: string; language: string | null } | null;
  identifiers: { scheme: string; normalized_value: string }[];
  record_contributors: { role: string; position: number; contributors: { display_name: string } | null }[];
  record_assets: { role: string; assets: { id: string; mime_type: string; file_size: number; file_format: string } | null }[];
}

function unauthorized(): Response {
  return new Response('Authentication required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Textus", charset="UTF-8"' } });
}

function basicCredentials(req: Request): { email: string; password: string } | null {
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Basic ')) return null;
  try {
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)));
    const at = decoded.indexOf(':');
    return at > 0 ? { email: decoded.slice(0, at), password: decoded.slice(at + 1) } : null;
  } catch {
    return null;
  }
}

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    const creds = basicCredentials(req);
    if (!creds) return unauthorized();
    const { error: signInError } = await ctx.supabase.auth.signInWithPassword(creds);
    if (signInError) return unauthorized();

    const url = new URL(req.url);
    const root = `${Deno.env.get('SUPABASE_URL') ?? url.origin}/functions/v1/opds`;
    const rest = url.pathname.split('/opds').pop()?.replace(/^\/+|\/+$/g, '') ?? '';

    if (rest.startsWith('download/')) {
      const assetId = rest.slice('download/'.length);
      const { data: asset } = await ctx.supabase.from('assets').select('bucket, storage_path').eq('id', assetId).maybeSingle();
      if (!asset) return new Response('Not found', { status: 404 });
      const { data, error } = await ctx.supabase.storage.from(asset.bucket).createSignedUrl(asset.storage_path, 300, { download: true });
      if (error || !data) return new Response('Could not prepare the download', { status: 500 });
      return Response.redirect(data.signedUrl, 302);
    }
    if (rest !== '') return new Response('Not found', { status: 404 });

    const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
    const from = (page - 1) * PAGE_SIZE;
    const { data, error } = await ctx.supabase
      .from('records')
      .select(SELECT)
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE_SIZE) // one extra row tells us whether a next page exists
      .returns<Row[]>();
    if (error) {
      console.error('opds: query failed', error.message); // technical detail stays server-side
      return new Response('Catalog unavailable', { status: 500 });
    }

    const entries: OpdsEntry[] = data.slice(0, PAGE_SIZE).flatMap((r) => {
      const acquisitions = r.record_assets
        .filter((a) => a.role === 'primary' && a.assets)
        .map((a) => ({ href: `${root}/download/${a.assets!.id}`, type: a.assets!.mime_type, length: a.assets!.file_size }));
      if (!acquisitions.length) return []; // an OPDS entry with nothing to download is noise
      const credits = [...r.record_contributors].sort((a, b) => a.position - b.position);
      const role = BYLINE_ROLES.find((ro) => credits.some((c) => c.role === ro));
      return [{
        id: r.id,
        title: r.title ?? r.works?.title ?? 'Untitled',
        updated: r.updated_at ?? new Date().toISOString(),
        authors: credits.filter((c) => c.role === role && c.contributors).map((c) => c.contributors!.display_name),
        language: r.works?.language ?? undefined,
        publisher: r.publisher ?? undefined,
        issued: r.publication_date?.slice(0, 4),
        identifiers: r.identifiers.filter((i) => i.scheme === 'isbn' || i.scheme === 'doi').map((i) => `urn:${i.scheme}:${i.normalized_value}`),
        acquisitions,
      }];
    });

    const xml = buildFeed({
      selfUrl: page === 1 ? root : `${root}?page=${page}`,
      startUrl: root,
      updated: new Date().toISOString(),
      entries,
      nextUrl: data.length > PAGE_SIZE ? `${root}?page=${page + 1}` : undefined,
    });
    return new Response(xml, { headers: { 'Content-Type': FEED_TYPE, 'Cache-Control': 'private, no-store' } });
  }),
};
