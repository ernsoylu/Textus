import { withSupabase } from '@supabase/server';
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

const HOSTS = new Set(['openlibrary.org', 'api.crossref.org', 'export.arxiv.org', 'api.semanticscholar.org', 'www.googleapis.com']);
async function get(url: URL, headers: Record<string, string> = {}): Promise<{ response: Response; body: string }> {
  if (!HOSTS.has(url.hostname) || url.protocol !== 'https:') throw new Error('provider host is not allowed');
  let response: Response;
  for (let redirects = 0;; redirects++) {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000), redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (redirects >= 3) throw new Error('too many provider redirects');
    const location = response.headers.get('location');
    if (!location) throw new Error('provider redirect missing location');
    const next = new URL(location, url);
    if (next.protocol !== 'https:' || next.hostname !== url.hostname || !HOSTS.has(next.hostname)) throw new Error('provider redirect host is not allowed');
    url = next;
  }
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 5_000_000) throw new Error('provider response too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('provider returned no body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 5_000_000) { await reader.cancel(); throw new Error('provider response too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { response, body: new TextDecoder().decode(bytes) };
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function str(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function first(value: unknown): string | undefined { return Array.isArray(value) ? str(value[0]) : str(value); }
function year(value: unknown): string | undefined { const n = Number(value); return Number.isInteger(n) && n >= 1000 && n <= 9999 ? `${n}-01-01` : undefined; }
function xml(value: string, tag: string): string | undefined { return str(stripTags(xmlElementText(value, tag) ?? '').replaceAll('&amp;', '&')); }

export async function provider(name: string, id: string): Promise<Lookup> {
  try {
    let url: URL;
    const headers: Record<string, string> = {};
    if (name === 'openlibrary') {
      url = new URL(`/isbn/${encodeURIComponent(id)}.json`, 'https://openlibrary.org');
      headers['User-Agent'] = `Textus metadata lookup (${Deno.env.get('CROSSREF_MAILTO') ?? 'self-hosted'})`;
    } else if (name === 'crossref' || name === 'crossref_journal') {
      url = new URL(`/${name === 'crossref' ? 'works' : 'journals'}/${encodeURIComponent(id)}`, 'https://api.crossref.org');
      const mailto = Deno.env.get('CROSSREF_MAILTO');
      if (mailto) url.searchParams.set('mailto', mailto);
    } else if (name === 'arxiv') {
      url = new URL('/api/query', 'https://export.arxiv.org');
      url.searchParams.set('id_list', id);
    } else if (name === 'semantic_scholar') {
      url = new URL(`/graph/v1/paper/${encodeURIComponent(id)}`, 'https://api.semanticscholar.org');
      url.searchParams.set('fields', 'title,abstract,year,publicationDate,authors,externalIds,journal,openAccessPdf');
      const key = Deno.env.get('SEMANTIC_SCHOLAR_API_KEY');
      if (key) headers['x-api-key'] = key;
    } else {
      url = new URL('/books/v1/volumes', 'https://www.googleapis.com');
      url.searchParams.set('q', `isbn:${id}`);
      url.searchParams.set('key', Deno.env.get('GOOGLE_BOOKS_API_KEY') ?? '');
    }
    const { response, body } = await get(url, headers);
    if (response.status === 404) return { kind: 'not_found' };
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      return { kind: 'rate_limited', retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000 };
    }
    if (!response.ok) return { kind: 'provider_error', message: `HTTP ${response.status}` };
    let data: Metadata;
    if (name === 'arxiv') {
      const entry = /<entry>([\s\S]*?)<\/entry>/.exec(body)?.[1];
      const title = entry && xml(entry, 'title');
      if (!title) return { kind: 'not_found' };
      data = { title, abstract: xml(entry!, 'summary'), publication_date: xml(entry!, 'published')?.slice(0, 10), publication_date_precision: 'day', contributors: [...entry!.matchAll(/<author>([\s\S]*?)<\/author>/g)].map((m) => ({ name: xml(m[1], 'name') ?? '', role: 'author' as const })).filter((a) => a.name), source_provider: name, source_url: `https://arxiv.org/abs/${id}`, work_type: 'article' };
    } else {
      const root = object(JSON.parse(body));
      if (name === 'openlibrary') {
        const title = str(root.title);
        if (!title) throw new Error('missing title');
        const authorKeys = Array.isArray(root.authors) ? root.authors.map((a) => str(object(a).key)).filter((s): s is string => !!s && /^\/authors\/OL\d+A$/.test(s)).slice(0, 100) : [];
        const authors = await Promise.all(authorKeys.map(async (key) => {
          const result = await get(new URL(`${key}.json`, 'https://openlibrary.org'));
          if (!result.response.ok) return null;
          return { name: str(object(JSON.parse(result.body)).name) ?? '', role: 'author' as const, identifiers: { openlibrary: key.split('/').at(-1)! } };
        }));
        data = { title, publication_date: year(root.publish_date) ?? (str(root.publish_date)?.match(/\b\d{4}\b/) ? year(str(root.publish_date)!.match(/\b\d{4}\b/)![0]) : undefined), publication_date_precision: 'year', publisher: first(root.publishers), contributors: authors.filter((a): a is NonNullable<typeof a> => !!a && !!a.name), cover_url: Array.isArray(root.covers) && Number.isInteger(root.covers[0]) ? `https://covers.openlibrary.org/b/id/${root.covers[0]}-L.jpg` : undefined, role_warning: /\bedit(?:ed|or|ors)\b/i.test(`${title} ${str(root.by_statement) ?? ''}`) ? 'This book may credit editors as authors. Review contributor roles.' : undefined, source_provider: name, source_url: `https://openlibrary.org/isbn/${id}`, work_type: 'book' };
      } else if (name === 'google_books') {
        const volume = object(Array.isArray(root.items) ? root.items[0] : null);
        const info = object(volume.volumeInfo);
        const title = str(info.title);
        if (!title) return { kind: 'not_found' };
        const published = str(info.publishedDate);
        data = { title, subtitle: str(info.subtitle), abstract: str(info.description), language: str(info.language), publication_date: published && /^\d{4}(-\d{2}){0,2}$/.test(published) ? published.length === 4 ? `${published}-01-01` : published.length === 7 ? `${published}-01` : published : undefined, publication_date_precision: published ? published.length === 10 ? 'day' : published.length === 7 ? 'month' : 'year' : undefined, publisher: str(info.publisher), contributors: Array.isArray(info.authors) ? info.authors.map((a) => ({ name: String(a), role: 'author' as const })) : [], role_warning: /\bedit(?:ed|or|ors)\b/i.test(title) ? 'This book may credit editors as authors. Review contributor roles.' : undefined, source_provider: name, source_url: str(volume.selfLink), work_type: 'book' };
      } else if (name === 'crossref' || name === 'crossref_journal') {
        const item = object(root.message);
        const title = first(item.title);
        if (!title) throw new Error('missing title');
        const people = (role: 'author' | 'editor') => (Array.isArray(item[role]) ? item[role] : []).map((raw) => { const p = object(raw); const given = str(p.given); const family = str(p.family); const name = str(p.name) ?? [given, family].filter(Boolean).join(' '); const orcid = str(p.ORCID)?.split('/').at(-1); return { name, given, family, role, identifiers: orcid ? { orcid } : undefined, affiliation: str(object(Array.isArray(p.affiliation) ? p.affiliation[0] : null).name) }; }).filter((p) => p.name);
        const dateParts = object(item.published)['date-parts'];
        const parts = Array.isArray(dateParts) && Array.isArray(dateParts[0]) ? dateParts[0] as number[] : [];
        data = { title, abstract: (() => { const a = str(item.abstract); return a === undefined ? undefined : stripTags(a); })(), publication_date: parts[0] ? `${parts[0]}-${String(parts[1] ?? 1).padStart(2, '0')}-${String(parts[2] ?? 1).padStart(2, '0')}` : undefined, publication_date_precision: parts[0] ? parts.length >= 3 ? 'day' : parts.length === 2 ? 'month' : 'year' : undefined, publisher: str(item.publisher), volume: str(item.volume), issue_number: str(item.issue), pages: str(item.page), contributors: [...people('author'), ...people('editor')], source_provider: name, source_url: str(item.URL), work_type: name === 'crossref_journal' ? 'serial' : str(item.type) === 'book-chapter' ? 'chapter' : /^book/.test(str(item.type) ?? '') ? 'book' : 'article' };
      } else {
        const title = str(root.title);
        if (!title) return { kind: 'not_found' };
        data = { title, abstract: str(root.abstract), publication_date: str(root.publicationDate) ?? year(root.year), publication_date_precision: str(root.publicationDate) ? 'day' : year(root.year) ? 'year' : undefined, contributors: Array.isArray(root.authors) ? root.authors.map((raw) => { const a = object(raw); return { name: str(a.name) ?? '', role: 'author' as const, identifiers: str(a.authorId) ? { semantic_scholar: str(a.authorId)! } : undefined }; }).filter((a) => a.name) : [], source_provider: name, source_url: str(root.url), work_type: 'article' };
      }
    }
    return { kind: 'success', data };
  } catch (error) { return { kind: 'provider_error', message: error instanceof Error ? error.message : 'invalid response' }; }
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    const body = await req.json().catch(() => null);
    const cover = CoverSchema.safeParse(body);
    if (cover.success) {
      const target = new URL(cover.data.url);
      if (target.protocol !== 'https:' || target.hostname !== 'covers.openlibrary.org') return Response.json({ error: 'invalid_cover_url' }, { status: 400 });
      const { data: record } = await ctx.supabase.from('records').select('id').eq('id', cover.data.recordId).maybeSingle();
      if (!record) return Response.json({ error: 'not_found' }, { status: 404 });
      const { data: user } = await ctx.supabase.auth.getUser();
      if (!user.user) return Response.json({ error: 'unauthorized' }, { status: 401 });
      const { error } = await ctx.supabaseAdmin.from('jobs').upsert({ user_id: user.user.id, job_type: 'process_cover', payload: { record_id: record.id, url: cover.data.url }, idempotency_key: `process_cover:${record.id}:${cover.data.url}` }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
      if (error) return Response.json({ error: 'could_not_queue_cover' }, { status: 500 });
      return Response.json({ status: 'queued' });
    }
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ status: 'invalid_identifier', scheme: '', reason: 'Invalid request' });
    const { scheme, value } = parsed.data.identifier;
    const identifier = parseIdentifier(scheme, value);
    if (!identifier.ok) return Response.json({ status: 'invalid_identifier', scheme, reason: identifier.reason });
    const id = identifier.normalized;
    if (!parsed.data.bypassCache) {
      const { data: cached } = await ctx.supabase.from('metadata_cache').select('response_data,fetched_at').eq('identifier_scheme', scheme).eq('identifier_value', id).gt('expires_at', new Date().toISOString()).order('fetched_at', { ascending: false }).limit(1).maybeSingle();
      if (cached && (!object(cached.response_data).publication_date || object(cached.response_data).publication_date_precision)) return Response.json({ status: 'success', data: cached.response_data, fromCache: true, fetchedAt: cached.fetched_at ?? new Date().toISOString() });
    }
    let providers: string[];
    switch (scheme) {
      case 'isbn': providers = ['openlibrary', ...(Deno.env.get('GOOGLE_BOOKS_API_KEY') ? ['google_books'] : [])]; break;
      case 'doi': providers = ['crossref', 'semantic_scholar']; break;
      case 'arxiv': providers = ['arxiv', 'semantic_scholar']; break;
      case 'pmid': providers = ['semantic_scholar']; break;
      case 'issn': providers = ['crossref_journal']; break;
      default: { const exhaustive: never = scheme; throw new Error(`Unhandled scheme ${exhaustive}`); }
    }
    let failure: { provider: string; result: Lookup } | undefined;
    for (const name of providers) {
      const providerId = name === 'semantic_scholar' ? `${scheme.toUpperCase()}:${id}` : id;
      const result = await provider(name, providerId);
      if (result.kind === 'success') {
        const fetchedAt = new Date().toISOString();
        const { error } = await ctx.supabaseAdmin.from('metadata_cache').upsert({ identifier_scheme: scheme, identifier_value: id, provider: name, response_data: result.data, fetched_at: fetchedAt, expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }, { onConflict: 'identifier_scheme,identifier_value,provider' });
        if (error) console.error('metadata cache write failed:', error);
        return Response.json({ status: 'success', data: result.data, fromCache: false, fetchedAt });
      }
      if (result.kind !== 'not_found') failure = { provider: name, result };
    }
    if (failure?.result.kind === 'rate_limited') return Response.json({ status: 'rate_limited', provider: failure.provider, retryAfterMs: failure.result.retryAfterMs });
    if (failure?.result.kind === 'provider_error') return Response.json({ status: 'provider_error', provider: failure.provider, message: failure.result.message });
    return Response.json({ status: 'not_found', identifier: id, searchedProviders: providers });
  }),
};
