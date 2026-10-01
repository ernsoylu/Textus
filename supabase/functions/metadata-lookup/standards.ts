import { boundedFetch as fetch } from '../_shared/budget.ts';
import { z } from 'zod';
import { parseStandardReference, type StandardScheme } from '../_shared/identifier.ts';
import { readCapped } from '../_shared/http.ts';
import type { Lookup, Metadata } from './index.ts';

const CATALOGUES: Record<StandardScheme, { site: string; host: string; path: RegExp; publisher: string }> = {
  iso: { site: 'iso.org/standard', host: 'www.iso.org', path: /^\/standard\/\d+(?:\.html)?$/, publisher: 'ISO' },
  iec: { site: 'webstore.iec.ch', host: 'webstore.iec.ch', path: /^\/(?:en\/)?publication\//, publisher: 'IEC' },
  astm: { site: 'store.astm.org', host: 'store.astm.org', path: /^\/[a-z0-9-]+\.html$/, publisher: 'ASTM International' },
  asme: { site: 'asme.org/codes-standards/find-codes-standards', host: 'www.asme.org', path: /^\/codes-standards\/find-codes-standards\//, publisher: 'ASME' },
  bs: { site: 'knowledge.bsigroup.com/products', host: 'knowledge.bsigroup.com', path: /^\/products\//, publisher: 'BSI' },
};

const fieldNames = ['reference', 'title', 'abstract', 'publication_date', 'edition', 'publisher', 'language', 'status'] as const;
const extractionSchema = {
  type: 'object',
  properties: {
    ...Object.fromEntries(fieldNames.map((field) => [field, { type: ['string', 'null'] }])),
    pages: { type: ['integer', 'null'], minimum: 1 },
  },
  required: [...fieldNames, 'pages'],
  additionalProperties: false,
};
const extractedSchema = z.object({
  reference: z.string().max(200).nullable(), title: z.string().max(1000).nullable(),
  abstract: z.string().max(20000).nullable(), publication_date: z.string().max(10).nullable(),
  edition: z.string().max(100).nullable(), publisher: z.string().max(500).nullable(),
  language: z.string().max(20).nullable(), status: z.string().max(100).nullable(),
  pages: z.number().int().min(1).max(100000).nullable(),
});

class CatalogueError extends Error {
  constructor(public status: number, public retryAfterMs = 60_000) {
    super(`Catalogue service returned HTTP ${status}.`);
  }
}

async function firecrawl(endpoint: 'search' | 'scrape', body: unknown, key: string): Promise<unknown> {
  const response = await fetch(`https://api.firecrawl.dev/v2/${endpoint}`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const seconds = Number(response.headers.get('retry-after'));
    throw new CatalogueError(response.status, seconds > 0 ? seconds * 1000 : 60_000);
  }
  const parsed = z.object({ success: z.literal(true), data: z.unknown() }).parse(JSON.parse(await readCapped(response)));
  return parsed.data;
}

function officialUrl(value: string, scheme: StandardScheme): boolean {
  try {
    const url = new URL(value);
    const catalogue = CATALOGUES[scheme];
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && url.hostname === catalogue.host && catalogue.path.test(url.pathname);
  } catch { return false; }
}

function publicationDate(value: string | null): Pick<Metadata, 'publication_date' | 'publication_date_precision'> {
  if (!value || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return {};
  const parts = value.split('-');
  const date = `${parts[0]}-${parts[1] ?? '01'}-${parts[2] ?? '01'}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return {};
  return { publication_date: date, publication_date_precision: parts.length === 1 ? 'year' : parts.length === 2 ? 'month' : 'day' };
}

function iecMetadata(markdown: string) {
  const heading = /^# [^\n]+\n/m.exec(markdown);
  if (!heading) return undefined;
  const main = markdown.slice(heading.index + heading[0].length);
  const paragraphs = main.trim().split(/\n\s*\n/);
  const reference = paragraphs[0]?.trim();
  const row = (name: string) => new RegExp(`^\\|\\s*\\*\\*${name}\\*\\*\\s*\\|\\s*([^|]+)`, 'm').exec(main)?.[1].trim() ?? null;
  const history = main.split('\n').find((line) => line.startsWith('|') && line.includes(`[${reference}](`));
  return {
    reference, title: paragraphs[1]?.trim(),
    abstract: paragraphs.slice(2).join('\n\n').split(/Show moreShow less|BASE PUBLICATION|AMENDMENT/)[0].trim() || null,
    publication_date: row('Publication date'), edition: row('Edition'), publisher: 'IEC', language: null,
    pages: row('Pages') ? Number(row('Pages')) : null,
    status: history?.split('|').map((cell) => cell.trim()).filter(Boolean).at(-1) ?? null,
  };
}

export async function standardProvider(scheme: StandardScheme, reference: string): Promise<Lookup> {
  const key = Deno.env.get('FIRECRAWL_API_KEY');
  if (!key) return { kind: 'provider_error', message: 'Standards lookup is not configured on this server.' };
  const expected = parseStandardReference(scheme, reference);
  if (!expected.ok) return { kind: 'provider_error', message: 'A standard reference including its edition year is required.' };
  const searchReference = expected.normalized.replace(/^(ISO(?:\/(?:IEC|PAS|TS|TR|IWA|GUIDE))*|IEC(?:\/ISO)?(?:TS|TR|PAS)?|ASTM|ASME|BS(?:EN)?(?:ISO|IEC)?)/, '$1 ')
    .replace(/^BSEN/, 'BS EN ').replace(/^BS(?=ISO|IEC)/, 'BS ').replace(/(ISO|IEC)(?=\d)/, '$1 ').replace(/^IEC(TS|TR|PAS)/, 'IEC $1');
  try {
    const search = z.object({ web: z.array(z.object({ url: z.string().url(), title: z.string().optional() })).default([]) }).parse(await firecrawl('search', {
      query: `site:${CATALOGUES[scheme].site} ${searchReference}`, limit: 3, sources: ['web'], timeout: 15_000,
    }, key));
    let extractionFailed = false;
    for (const result of search.web.filter((result) => officialUrl(result.url, scheme) && (scheme !== 'bs' || result.title?.toUpperCase().startsWith('BS ')))) {
      const url = result.url;
      const page = z.object({ markdown: z.string().optional(), json: z.unknown(), metadata: z.object({ sourceURL: z.string().optional(), url: z.string().optional(), statusCode: z.number().optional() }).optional() }).parse(await firecrawl('scrape', {
        url, timeout: 15_000, onlyMainContent: true,
        formats: scheme === 'iec' ? ['markdown'] : ['markdown', { type: 'json', schema: extractionSchema, prompt: 'Extract the MAIN standard publication starting at the FIRST H1 heading on this catalogue page. For ASME read the H3 below the H1 for its reference and edition year. Use its displayed full reference including edition year and amendments, never a successor, citation, or an edition merely listed in a selector. Do not infer the requested edition. Extract title without the reference prefix, abstract, publication date in YYYY, YYYY-MM or YYYY-MM-DD, edition, publisher, language, status and page count. Missing fields must be null. Do not guess.' }],
      }, key));
      if (page.metadata?.statusCode && page.metadata.statusCode >= 400) { extractionFailed = true; continue; }
      if (!officialUrl(page.metadata?.url ?? page.metadata?.sourceURL ?? url, scheme)) { extractionFailed = true; continue; }
      const parsed = extractedSchema.safeParse(scheme === 'iec' ? iecMetadata(page.markdown ?? '') : page.json);
      if (!parsed.success) { extractionFailed = true; continue; }
      const data = parsed.data;
      // BSI's tracked-changes suffix describes the presentation, not a different edition.
      if (scheme === 'bs' && data.reference) data.reference = data.reference.replace(/\s*-\s*TC$/i, '').trim();
      if (!data.reference || !data.title?.trim()) continue;
      const actual = parseStandardReference(scheme, data.reference);
      if (!actual.ok || actual.normalized !== expected.normalized) continue;
      // Match the real page too: structured extraction cannot invent a matching reference.
      const pageText = page.markdown?.toUpperCase().replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, '') ?? '';
      const pageReference = scheme === 'asme' ? expected.normalized.replace(/^ASME/, '') : expected.normalized;
      if (!pageText.includes(pageReference)) continue;
      return { kind: 'success', data: {
        title: data.title.trim(), abstract: data.abstract?.trim() || undefined,
        ...publicationDate(data.publication_date), edition: data.edition?.trim() || undefined,
        publisher: data.publisher?.trim() || CATALOGUES[scheme].publisher, language: data.language?.trim() || undefined,
        pages: data.pages ? String(data.pages) : undefined, standard_status: data.status?.trim() || undefined,
        standard_scheme: scheme, standard_reference: data.reference.trim(),
        source_provider: scheme, source_url: url, work_type: 'standard',
      } };
    }
    return extractionFailed ? { kind: 'provider_error', message: 'The official catalogue could not be read. Try again later.' } : { kind: 'not_found' };
  } catch (error) {
    if (error instanceof CatalogueError && error.status === 429) return { kind: 'rate_limited', retryAfterMs: error.retryAfterMs };
    return { kind: 'provider_error', message: error instanceof CatalogueError ? error.message : 'Catalogue lookup failed. Try again later.' };
  }
}
