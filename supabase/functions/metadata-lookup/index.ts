import { withSupabase, type SupabaseContext } from '@supabase/server';
import { z } from 'zod';
import { parseIdentifier } from '../_shared/identifier.ts';
import { stripTags, xmlElementText } from '../_shared/text.ts';

const RequestSchema = z.object({
  identifier: z.object({ scheme: z.enum(['isbn', 'doi', 'issn', 'arxiv', 'pmid']), value: z.string().min(1).max(300) }),
  bypassCache: z.boolean().optional(),
});
const CoverSchema = z.object({ action: z.literal('queue-cover'), recordId: z.string().uuid(), url: z.string().url().max(1000) });
type Metadata = { title?: string; subtitle?: string; abstract?: string; language?: string; publication_date?: string; publication_date_precision?: 'year' | 'month' | 'day'; publisher?: string; volume?: string; issue_number?: string; pages?: string; contributors?: { name: string; given?: string; family?: string; role: 'author' | 'editor'; identifiers?: Record<string, string>; affiliation?: string }[]; cover_url?: string; role_warning?: string; source_provider: string; source_url?: string; work_type: string };
type Lookup = { kind: 'success'; data: Metadata } | { kind: 'not_found' } | { kind: 'rate_limited'; retryAfterMs: number } | { kind: 'provider_error'; message: string };

const HOSTS = new Set(['openlibrary.org', 'api.crossref.org', 'export.arxiv.org', 'api.semanticscholar.org', 'www.googleapis.com', 'archive.org']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_RESPONSE_BYTES = 5_000_000;

async function fetchFollowingRedirects(start: URL, headers: Record<string, string>): Promise<Response> {
  if (!HOSTS.has(start.hostname) || start.protocol !== 'https:') throw new Error('provider host is not allowed');
  let url = start;
  for (let redirects = 0;; redirects++) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000), redirect: 'manual' });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    if (redirects >= 3) throw new Error('too many provider redirects');
    const location = response.headers.get('location');
    if (!location) throw new Error('provider redirect missing location');
    const next = new URL(location, url);
    if (next.protocol !== 'https:' || next.hostname !== url.hostname || !HOSTS.has(next.hostname)) throw new Error('provider redirect host is not allowed');
    url = next;
  }
}

async function readCapped(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length') ?? 0) > MAX_RESPONSE_BYTES) throw new Error('provider response too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('provider returned no body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('provider response too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

async function get(url: URL, headers: Record<string, string> = {}): Promise<{ response: Response; body: string }> {
  const response = await fetchFollowingRedirects(url, headers);
  return { response, body: await readCapped(response) };
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function str(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function first(value: unknown): string | undefined { return Array.isArray(value) ? str(value[0]) : str(value); }
function year(value: unknown): string | undefined { const n = Number(value); return Number.isInteger(n) && n >= 1000 && n <= 9999 ? `${n}-01-01` : undefined; }
function xml(value: string, tag: string): string | undefined { return str(stripTags(xmlElementText(value, tag) ?? '').replaceAll('&amp;', '&')); }


type Precision = 'year' | 'month' | 'day';
type Parsed = Metadata | null; // null: the provider answered but has no such record
const EDITOR_WARNING = 'This book may credit editors as authors. Review contributor roles.';

const editorWarning = (text: string) => (/\bedit(?:ed|or|ors)\b/i.test(text) ? EDITOR_WARNING : undefined);
function precisionForParts(count: number): Precision {
  if (count >= 3) return 'day';
  return count === 2 ? 'month' : 'year';
}
function precisionForLength(length: number): Precision {
  if (length === 10) return 'day';
  return length === 7 ? 'month' : 'year';
}
function yearInText(text: string | undefined): string | undefined { const found = text ? /\b\d{4}\b/.exec(text) : null; return found ? year(found[0]) : undefined; }

function providerRequest(name: string, id: string): { url: URL; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  if (name === 'openlibrary') {
    headers['User-Agent'] = `Textus metadata lookup (${Deno.env.get('CROSSREF_MAILTO') ?? 'self-hosted'})`;
    return { url: new URL(`/isbn/${encodeURIComponent(id)}.json`, 'https://openlibrary.org'), headers };
  }
  if (name === 'internet_archive') {
    const url = new URL('/advancedsearch.php', 'https://archive.org');
    url.searchParams.set('q', `isbn:${id} AND mediatype:texts`);
    for (const field of ['identifier', 'title', 'description', 'creator', 'date', 'publisher', 'language']) url.searchParams.append('fl[]', field);
    url.searchParams.set('rows', '1');
    url.searchParams.set('output', 'json');
    return { url, headers };
  }
  if (name === 'crossref' || name === 'crossref_journal') {
    const url = new URL(`/${name === 'crossref' ? 'works' : 'journals'}/${encodeURIComponent(id)}`, 'https://api.crossref.org');
    const mailto = Deno.env.get('CROSSREF_MAILTO');
    if (mailto) url.searchParams.set('mailto', mailto);
    return { url, headers };
  }
  if (name === 'arxiv') {
    const url = new URL('/api/query', 'https://export.arxiv.org');
    url.searchParams.set('id_list', id);
    return { url, headers };
  }
  if (name === 'semantic_scholar') {
    const url = new URL(`/graph/v1/paper/${encodeURIComponent(id)}`, 'https://api.semanticscholar.org');
    url.searchParams.set('fields', 'title,abstract,year,publicationDate,authors,externalIds,journal,openAccessPdf');
    const key = Deno.env.get('SEMANTIC_SCHOLAR_API_KEY');
    if (key) headers['x-api-key'] = key;
    return { url, headers };
  }
  const url = new URL('/books/v1/volumes', 'https://www.googleapis.com');
  url.searchParams.set('q', `isbn:${id}`);
  url.searchParams.set('key', Deno.env.get('GOOGLE_BOOKS_API_KEY') ?? '');
  return { url, headers };
}

function parseArxiv(body: string, id: string, name: string): Parsed {
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(body)?.[1];
  if (!entry) return null;
  const title = xml(entry, 'title');
  if (!title) return null;
  const contributors = [...entry.matchAll(/<author>([\s\S]*?)<\/author>/g)].map((m) => ({ name: xml(m[1], 'name') ?? '', role: 'author' as const })).filter((a) => a.name);
  return { title, abstract: xml(entry, 'summary'), publication_date: xml(entry, 'published')?.slice(0, 10), publication_date_precision: 'day', contributors, source_provider: name, source_url: `https://arxiv.org/abs/${id}`, work_type: 'article' };
}

async function openLibraryAuthors(root: Record<string, unknown>) {
  const keys = Array.isArray(root.authors) ? root.authors.map((a) => str(object(a).key)).filter((k): k is string => !!k && /^\/authors\/OL\d+A$/.test(k)).slice(0, 100) : [];
  const authors = await Promise.all(keys.map(async (key) => {
    const result = await get(new URL(`${key}.json`, 'https://openlibrary.org'));
    if (!result.response.ok) return null;
    return { name: str(object(JSON.parse(result.body)).name) ?? '', role: 'author' as const, identifiers: { openlibrary: key.split('/').at(-1)! } };
  }));
  return authors.filter((a): a is NonNullable<typeof a> => !!a && !!a.name);
}

async function parseOpenLibrary(root: Record<string, unknown>, id: string, name: string): Promise<Metadata> {
  const title = str(root.title);
  if (!title) throw new Error('missing title');
  const coverId = Array.isArray(root.covers) ? root.covers[0] : undefined;
  const description = typeof root.description === 'string' ? root.description : str(object(root.description).value);
  return {
    title,
    abstract: description,
    publication_date: year(root.publish_date) ?? yearInText(str(root.publish_date)),
    publication_date_precision: 'year',
    publisher: first(root.publishers),
    contributors: await openLibraryAuthors(root),
    cover_url: Number.isInteger(coverId) ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : undefined,
    role_warning: editorWarning(`${title} ${str(root.by_statement) ?? ''}`),
    source_provider: name,
    source_url: `https://openlibrary.org/isbn/${id}`,
    work_type: 'book',
  };
}

function parseGoogleBooks(root: Record<string, unknown>, name: string): Parsed {
  const volume = object(Array.isArray(root.items) ? root.items[0] : null);
  const info = object(volume.volumeInfo);
  const title = str(info.title);
  if (!title) return null;
  const published = str(info.publishedDate);
  let publicationDate: string | undefined;
  if (published && /^\d{4}(-\d{2}){0,2}$/.test(published)) {
    publicationDate = ({ 4: `${published}-01-01`, 7: `${published}-01` } as Record<number, string>)[published.length] ?? published;
  }
  return {
    title,
    subtitle: str(info.subtitle),
    abstract: str(info.description),
    language: str(info.language),
    publication_date: publicationDate,
    publication_date_precision: published ? precisionForLength(published.length) : undefined,
    publisher: str(info.publisher),
    contributors: Array.isArray(info.authors) ? info.authors.map((a) => ({ name: String(a), role: 'author' as const })) : [],
    role_warning: editorWarning(title),
    source_provider: name,
    source_url: str(volume.selfLink),
    work_type: 'book',
  };
}

function parseInternetArchive(root: Record<string, unknown>, name: string): Parsed {
  const docs = object(root.response).docs;
  const item = object(Array.isArray(docs) ? docs[0] : null);
  const title = first(item.title);
  const identifier = str(item.identifier);
  if (!title || !identifier) return null;
  const creators = Array.isArray(item.creator) ? item.creator : [item.creator];
  const description = first(item.description);
  const publicationDate = yearInText(first(item.date));
  return {
    title,
    abstract: description ? stripTags(description) : undefined,
    language: first(item.language),
    publication_date: publicationDate,
    // Archive's search index expands year-only dates to January 1; retain year precision.
    publication_date_precision: publicationDate ? 'year' : undefined,
    publisher: first(item.publisher),
    contributors: creators.flatMap((value) => { const name = str(value); return name ? [{ name, role: 'author' as const }] : []; }),
    role_warning: editorWarning(title),
    source_provider: name,
    source_url: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    work_type: 'book',
  };
}

function crossrefPeople(item: Record<string, unknown>, role: 'author' | 'editor') {
  const raw = Array.isArray(item[role]) ? item[role] : [];
  return raw.map((entry) => {
    const p = object(entry);
    const given = str(p.given);
    const family = str(p.family);
    const orcid = str(p.ORCID)?.split('/').at(-1);
    return {
      name: str(p.name) ?? [given, family].filter(Boolean).join(' '),
      given,
      family,
      role,
      identifiers: orcid ? { orcid } : undefined,
      affiliation: str(object(Array.isArray(p.affiliation) ? p.affiliation[0] : null).name),
    };
  }).filter((p) => p.name);
}

function crossrefWorkType(name: string, item: Record<string, unknown>): string {
  if (name === 'crossref_journal') return 'serial';
  const type = str(item.type);
  if (type === 'book-chapter') return 'chapter';
  return type?.startsWith('book') ? 'book' : 'article';
}

function parseCrossref(root: Record<string, unknown>, name: string): Metadata {
  const item = object(root.message);
  const title = first(item.title);
  if (!title) throw new Error('missing title');
  const dateParts = object(item.published)['date-parts'];
  const parts = Array.isArray(dateParts) && Array.isArray(dateParts[0]) ? dateParts[0] as number[] : [];
  const abstract = str(item.abstract);
  return {
    title,
    abstract: abstract === undefined ? undefined : stripTags(abstract),
    publication_date: parts[0] ? `${parts[0]}-${String(parts[1] ?? 1).padStart(2, '0')}-${String(parts[2] ?? 1).padStart(2, '0')}` : undefined,
    publication_date_precision: parts[0] ? precisionForParts(parts.length) : undefined,
    publisher: str(item.publisher),
    volume: str(item.volume),
    issue_number: str(item.issue),
    pages: str(item.page),
    contributors: [...crossrefPeople(item, 'author'), ...crossrefPeople(item, 'editor')],
    source_provider: name,
    source_url: str(item.URL),
    work_type: crossrefWorkType(name, item),
  };
}

function parseSemanticScholar(root: Record<string, unknown>, name: string): Parsed {
  const title = str(root.title);
  if (!title) return null;
  const published = str(root.publicationDate);
  const yearOnly = year(root.year);
  let precision: Precision | undefined;
  if (published) precision = 'day';
  else if (yearOnly) precision = 'year';
  const contributors = Array.isArray(root.authors)
    ? root.authors.map((raw) => { const a = object(raw); const authorId = str(a.authorId); return { name: str(a.name) ?? '', role: 'author' as const, identifiers: authorId ? { semantic_scholar: authorId } : undefined }; }).filter((a) => a.name)
    : [];
  return { title, abstract: str(root.abstract), publication_date: published ?? yearOnly, publication_date_precision: precision, contributors, source_provider: name, source_url: str(root.url), work_type: 'article' };
}

async function parseBody(name: string, id: string, body: string): Promise<Parsed> {
  if (name === 'arxiv') return parseArxiv(body, id, name);
  const root = object(JSON.parse(body));
  if (name === 'openlibrary') return await parseOpenLibrary(root, id, name);
  if (name === 'google_books') return parseGoogleBooks(root, name);
  if (name === 'internet_archive') return parseInternetArchive(root, name);
  if (name === 'crossref' || name === 'crossref_journal') return parseCrossref(root, name);
  return parseSemanticScholar(root, name);
}

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
}

export async function provider(name: string, id: string): Promise<Lookup> {
  try {
    const { url, headers } = providerRequest(name, id);
    const { response, body } = await get(url, headers);
    if (response.status === 404) return { kind: 'not_found' };
    if (response.status === 429) return { kind: 'rate_limited', retryAfterMs: retryAfterMs(response) };
    if (!response.ok) return { kind: 'provider_error', message: `HTTP ${response.status}` };
    const data = await parseBody(name, id, body);
    return data ? { kind: 'success', data } : { kind: 'not_found' };
  } catch (error) { return { kind: 'provider_error', message: error instanceof Error ? error.message : 'invalid response' }; }
}

const CACHE_TTL_MS = 30 * 86_400_000;

async function queueCover(ctx: SupabaseContext, cover: z.infer<typeof CoverSchema>): Promise<Response> {
  const target = new URL(cover.url);
  if (target.protocol !== 'https:' || target.hostname !== 'covers.openlibrary.org') return Response.json({ error: 'invalid_cover_url' }, { status: 400 });
  const { data: record } = await ctx.supabase.from('records').select('id').eq('id', cover.recordId).maybeSingle();
  if (!record) return Response.json({ error: 'not_found' }, { status: 404 });
  const { data: user } = await ctx.supabase.auth.getUser();
  if (!user.user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const { error } = await ctx.supabaseAdmin.from('jobs').upsert({ user_id: user.user.id, job_type: 'process_cover', payload: { record_id: record.id, url: cover.url }, idempotency_key: `process_cover:${record.id}:${cover.url}` }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
  if (error) return Response.json({ error: 'could_not_queue_cover' }, { status: 500 });
  return Response.json({ status: 'queued' });
}

async function cachedLookup(ctx: SupabaseContext, scheme: string, id: string): Promise<Response | null> {
  const { data: cached } = await ctx.supabase.from('metadata_cache').select('response_data,fetched_at').eq('identifier_scheme', scheme).eq('identifier_value', id).gt('expires_at', new Date().toISOString()).order('fetched_at', { ascending: false }).limit(1).maybeSingle();
  if (!cached) return null;
  const data = object(cached.response_data);
  // An entry with a date but no precision predates precision tracking; refetch instead of serving it.
  if (data.publication_date && !data.publication_date_precision) return null;
  return Response.json({ status: 'success', data: cached.response_data, fromCache: true, fetchedAt: cached.fetched_at ?? new Date().toISOString() });
}

export function providersFor(scheme: 'isbn' | 'doi' | 'arxiv' | 'pmid' | 'issn'): string[] {
  switch (scheme) {
    case 'isbn': return ['openlibrary', ...(Deno.env.get('GOOGLE_BOOKS_API_KEY') ? ['google_books'] : []), 'internet_archive'];
    case 'doi': return ['crossref', 'semantic_scholar'];
    case 'arxiv': return ['arxiv', 'semantic_scholar'];
    case 'pmid': return ['semantic_scholar'];
    case 'issn': return ['crossref_journal'];
    default: { const exhaustive: never = scheme; throw new Error(`Unhandled scheme ${exhaustive}`); }
  }
}

export async function lookupAcrossProviders(ctx: SupabaseContext, scheme: 'isbn' | 'doi' | 'arxiv' | 'pmid' | 'issn', id: string): Promise<Response> {
  const providers = providersFor(scheme);
  let failure: { provider: string; result: Lookup } | undefined;
  let data: Metadata | undefined;
  for (const name of providers) {
    if (name === 'internet_archive' && data) break;
    const providerId = name === 'semantic_scholar' ? `${scheme.toUpperCase()}:${id}` : id;
    const result = await provider(name, providerId);
    if (result.kind === 'success') {
      const fetchedAt = new Date().toISOString();
      const { error } = await ctx.supabaseAdmin.from('metadata_cache').upsert({ identifier_scheme: scheme, identifier_value: id, provider: name, response_data: result.data, fetched_at: fetchedAt, expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString() }, { onConflict: 'identifier_scheme,identifier_value,provider' });
      if (error) console.error('metadata cache write failed:', error);
      if (!data) data = result.data;
      else for (const [key, value] of Object.entries(result.data)) {
        const current = data[key as keyof Metadata];
        if ((!current || (Array.isArray(current) && !current.length)) && value) Object.assign(data, { [key]: value });
      }
      continue;
    }
    if (result.kind !== 'not_found') failure = { provider: name, result };
  }
  if (data) return Response.json({ status: 'success', data, fromCache: false, fetchedAt: new Date().toISOString() });
  if (failure?.result.kind === 'rate_limited') return Response.json({ status: 'rate_limited', provider: failure.provider, retryAfterMs: failure.result.retryAfterMs });
  if (failure?.result.kind === 'provider_error') return Response.json({ status: 'provider_error', provider: failure.provider, message: failure.result.message });
  return Response.json({ status: 'not_found', identifier: id, searchedProviders: providers });
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const body = await req.json().catch(() => null);
    const cover = CoverSchema.safeParse(body);
    if (cover.success) return await queueCover(ctx, cover.data);
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ status: 'invalid_identifier', scheme: '', reason: 'Invalid request' });
    const { scheme, value } = parsed.data.identifier;
    const identifier = parseIdentifier(scheme, value);
    if (!identifier.ok) return Response.json({ status: 'invalid_identifier', scheme, reason: identifier.reason });
    if (!parsed.data.bypassCache) {
      const cached = await cachedLookup(ctx, scheme, identifier.normalized);
      if (cached) return cached;
    }
    return await lookupAcrossProviders(ctx, scheme, identifier.normalized);
  }),
};
