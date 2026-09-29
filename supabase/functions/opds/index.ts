// Edge Function: opds (§8.5, FR-SER-3). An OPDS 1.2 catalog for e-reader apps.
//
// E-readers cannot send a Supabase JWT, so this function does its own auth (`auth: 'none'`; the
// platform JWT check is off in config.toml): HTTP Basic with the account's email + password,
// exchanged for a session on the request-scoped anon client. Every query afterwards runs as that
// user under RLS, and no service-role client is used. Accounts that only use magic-link sign-in
// have no password and cannot use this feed.
//
// Files stay private (invariant 7): entries link to /opds/download/{assetId} and /opds/cover/{assetId},
// which re-authenticate and redirect to a fresh 300 s signed URL.
//
// Routes (all under /functions/v1/opds): "" (start, navigation), all, new, collections, collection/{id},
// search?q=, opensearch.xml, download/{assetId}, cover/{assetId}.
import { withSupabase, type SupabaseContext } from '@supabase/server';
import { ACQUISITION_TYPE, buildFeed, buildNavigationFeed, buildOpenSearch, NAVIGATION_TYPE, type OpdsEntry } from '../_shared/opds.ts';

const PAGE_SIZE = 100;
const NEW_SIZE = 25;
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
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.codePointAt(0)!));
    const at = decoded.indexOf(':');
    return at > 0 ? { email: decoded.slice(0, at), password: decoded.slice(at + 1) } : null;
  } catch {
    return null;
  }
}

const xml = (body: string, type: string) => new Response(body, { headers: { 'Content-Type': `${type};charset=utf-8`, 'Cache-Control': 'private, no-store' } });

function toEntries(rows: Row[], root: string): OpdsEntry[] {
  return rows.flatMap((r) => {
    const acquisitions = r.record_assets
      .filter((a) => a.role === 'primary' && a.assets)
      .map((a) => ({ href: `${root}/download/${a.assets!.id}`, type: a.assets!.mime_type, length: a.assets!.file_size }));
    if (!acquisitions.length) return []; // an OPDS entry with nothing to download is noise
    const coverAsset = r.record_assets.find((a) => a.role === 'cover' && a.assets)?.assets;
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
      cover: coverAsset ? { href: `${root}/cover/${coverAsset.id}`, type: coverAsset.mime_type } : undefined,
    }];
  });
}

async function fileRedirect(ctx: SupabaseContext, assetId: string): Promise<Response> {
  const { data: asset } = await ctx.supabase.from('assets').select('bucket, storage_path').eq('id', assetId).maybeSingle();
  if (!asset) return new Response('Not found', { status: 404 });
  const { data, error } = await ctx.supabase.storage.from(asset.bucket).createSignedUrl(asset.storage_path, 300, { download: true });
  if (error || !data) return new Response('Could not prepare the download', { status: 500 });
  return Response.redirect(data.signedUrl, 302);
}

function failure(message: string, error: { message: string }): Response {
  console.error(`opds: ${message}`, error.message); // technical detail stays server-side
  return new Response('Catalog unavailable', { status: 500 });
}

interface Route {
  ctx: SupabaseContext;
  root: string;
  url: URL;
  updated: string;
}

const navigation = (r: Route, selfUrl: string, entries: Parameters<typeof buildNavigationFeed>[0]['entries'], title?: string) =>
  xml(buildNavigationFeed({ selfUrl, startUrl: r.root, updated: r.updated, entries, title, searchUrl: `${r.root}/opensearch.xml` }), NAVIGATION_TYPE);

function startFeed(r: Route): Response {
  return navigation(r, r.root, [
    { id: 'urn:textus:all', title: 'All titles', summary: 'Everything in your library that has a file.', updated: r.updated, href: `${r.root}/all`, kind: 'acquisition' },
    { id: 'urn:textus:new', title: 'Recently added', summary: `The ${NEW_SIZE} newest titles.`, updated: r.updated, href: `${r.root}/new`, kind: 'acquisition' },
    { id: 'urn:textus:collections', title: 'Collections', summary: 'Your shelves, in your order.', updated: r.updated, href: `${r.root}/collections`, kind: 'navigation' },
  ]);
}

async function collectionsFeed(r: Route): Promise<Response> {
  const { data, error } = await r.ctx.supabase.from('collections').select('id, name, description, updated_at').order('name');
  if (error) return failure('collections query failed', error);
  return navigation(r, `${r.root}/collections`, data.map((c) => ({ id: `urn:uuid:${c.id}`, title: c.name, summary: c.description ?? undefined, updated: c.updated_at ?? r.updated, href: `${r.root}/collection/${c.id}`, kind: 'acquisition' as const })), 'Collections');
}

function acquisition(r: Route, rows: Row[], selfUrl: string, title: string, nextUrl?: string): Response {
  return xml(buildFeed({ selfUrl, startUrl: r.root, updated: r.updated, entries: toEntries(rows, r.root), title, nextUrl, searchUrl: `${r.root}/opensearch.xml` }), ACQUISITION_TYPE);
}

async function allFeed(r: Route): Promise<Response> {
  const page = Math.max(1, Number(r.url.searchParams.get('page')) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const { data, error } = await r.ctx.supabase.from('records').select(SELECT).order('updated_at', { ascending: false }).range(from, from + PAGE_SIZE).returns<Row[]>(); // one extra row tells us whether a next page exists
  if (error) return failure('all query failed', error);
  return acquisition(r, data.slice(0, PAGE_SIZE), page === 1 ? `${r.root}/all` : `${r.root}/all?page=${page}`, 'All titles', data.length > PAGE_SIZE ? `${r.root}/all?page=${page + 1}` : undefined);
}

async function newFeed(r: Route): Promise<Response> {
  const { data, error } = await r.ctx.supabase.from('records').select(SELECT).order('created_at', { ascending: false }).limit(NEW_SIZE).returns<Row[]>();
  if (error) return failure('new query failed', error);
  return acquisition(r, data, `${r.root}/new`, 'Recently added');
}

async function collectionFeed(r: Route, id: string): Promise<Response> {
  const { data, error } = await r.ctx.supabase.from('collection_records').select(`display_order, records ( ${SELECT} )`).eq('collection_id', id).order('display_order').returns<{ records: Row | null }[]>();
  if (error) return failure('collection query failed', error);
  const { data: collection } = await r.ctx.supabase.from('collections').select('name').eq('id', id).maybeSingle();
  if (!collection) return new Response('Not found', { status: 404 });
  return acquisition(r, data.flatMap((d) => (d.records ? [d.records] : [])), `${r.root}/collection/${id}`, collection.name);
}

async function searchFeed(r: Route): Promise<Response> {
  const q = (r.url.searchParams.get('q') ?? '').trim();
  const self = `${r.root}/search?q=${encodeURIComponent(q)}`;
  if (!q) return acquisition(r, [], self, 'Search');
  // The function has no generated Database type, so name the RPC's row shape here.
  const { data: hits, error } = await r.ctx.supabase.rpc('search_library', { p_query: q, p_limit: 50 }) as { data: { record_id: string }[] | null; error: { message: string } | null };
  if (error || !hits) return failure('search failed', error ?? { message: 'no result' });
  const ids = [...new Set(hits.map((h) => h.record_id))];
  if (!ids.length) return acquisition(r, [], self, `Search: ${q}`);
  const { data, error: recordsError } = await r.ctx.supabase.from('records').select(SELECT).in('id', ids).returns<Row[]>();
  if (recordsError) return failure('search records query failed', recordsError);
  const rank = new Map(ids.map((id, i) => [id, i]));
  return acquisition(r, [...data].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)), self, `Search: ${q}`);
}

async function route(r: Route, path: string): Promise<Response> {
  const [head, arg] = path.split('/');
  if (head === 'download' || head === 'cover') return await fileRedirect(r.ctx, arg ?? '');
  if (path === '') return startFeed(r);
  if (path === 'all') return await allFeed(r);
  if (path === 'new') return await newFeed(r);
  if (path === 'collections') return await collectionsFeed(r);
  if (head === 'collection' && arg) return await collectionFeed(r, arg);
  if (path === 'search') return await searchFeed(r);
  if (path === 'opensearch.xml') return xml(buildOpenSearch(`${r.root}/search?q={searchTerms}`), 'application/opensearchdescription+xml');
  return new Response('Not found', { status: 404 });
}

export default {
  fetch: withSupabase({ auth: 'none' }, async (req, ctx) => {
    const creds = basicCredentials(req);
    if (!creds) return unauthorized();
    const { error: signInError } = await ctx.supabase.auth.signInWithPassword(creds);
    if (signInError) return unauthorized();

    const url = new URL(req.url);
    const root = `${Deno.env.get('SUPABASE_PUBLIC_URL') ?? Deno.env.get('SUPABASE_URL') ?? url.origin}/functions/v1/opds`;
    const path = (url.pathname.split('/opds').pop() ?? '').split('/').filter(Boolean).join('/');
    return await route({ ctx, root, url, updated: new Date().toISOString() }, path);
  }),
};
