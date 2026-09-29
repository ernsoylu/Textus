// OPDS 1.2 catalog (FR-SER-3, §8.5): navigation feeds, acquisition feeds and the OpenSearch description.
// Pure and Edge-safe so the function and Vitest (via shared/opds.ts) share one implementation.

export interface OpdsAcquisition {
  href: string;
  type: string;
  length?: number;
}

export interface OpdsImage {
  href: string;
  type: string;
}

export interface OpdsEntry {
  id: string;
  title: string;
  updated: string;
  authors: string[];
  language?: string;
  publisher?: string;
  issued?: string;
  identifiers: string[]; // urn:isbn:…, urn:doi:…
  acquisitions: OpdsAcquisition[];
  cover?: OpdsImage;
}

// An entry that links to another feed rather than to a file.
export interface OpdsNavEntry {
  id: string;
  title: string;
  updated: string;
  href: string;
  summary?: string;
  kind: 'navigation' | 'acquisition';
}

export const NAVIGATION_TYPE = 'application/atom+xml;profile=opds-catalog;kind=navigation';
export const ACQUISITION_TYPE = 'application/atom+xml;profile=opds-catalog;kind=acquisition';

export function xmlEscape(text: string): string {
  // Also drops characters XML 1.0 forbids, which would make the whole feed unparseable.
  // deno-lint-ignore no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

const tag = (name: string, value: string | undefined) => (value ? `<${name}>${xmlEscape(value)}</${name}>` : '');
const link = (rel: string, href: string, type: string, extra = '') => `<link rel="${rel}" href="${xmlEscape(href)}" type="${xmlEscape(type)}"${extra}/>`;

function acquisitionXml(a: OpdsAcquisition): string {
  return link('http://opds-spec.org/acquisition', a.href, a.type, a.length ? ` length="${a.length}"` : ''); // NOSONAR — protocol-defined relation URI, not a network request
}

function entryXml(e: OpdsEntry): string {
  return [
    '<entry>',
    tag('title', e.title),
    `<id>urn:uuid:${xmlEscape(e.id)}</id>`,
    tag('updated', e.updated),
    ...e.authors.map((a) => `<author>${tag('name', a)}</author>`),
    tag('dc:language', e.language),
    tag('dc:publisher', e.publisher),
    tag('dc:issued', e.issued),
    ...e.identifiers.map((i) => tag('dc:identifier', i)),
    ...(e.cover ? [link('http://opds-spec.org/image', e.cover.href, e.cover.type), link('http://opds-spec.org/image/thumbnail', e.cover.href, e.cover.type)] : []), // NOSONAR — required OPDS relation identifiers, not HTTP requests
    ...e.acquisitions.map(acquisitionXml),
    '</entry>',
  ].join('');
}

function navEntryXml(e: OpdsNavEntry): string {
  return ['<entry>', tag('title', e.title), `<id>${xmlEscape(e.id)}</id>`, tag('updated', e.updated), tag('content', e.summary), link('subsection', e.href, e.kind === 'navigation' ? NAVIGATION_TYPE : ACQUISITION_TYPE), '</entry>'].join('');
}

interface FeedFrame {
  id: string;
  title: string;
  selfUrl: string;
  startUrl: string;
  updated: string;
  selfType: string;
  searchUrl?: string; // the OpenSearch description
  nextUrl?: string;
}

function feedXml(f: FeedFrame, entries: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/">',
    `<id>${xmlEscape(f.id)}</id>`,
    tag('title', f.title),
    tag('updated', f.updated),
    link('self', f.selfUrl, f.selfType),
    link('start', f.startUrl, NAVIGATION_TYPE),
    f.searchUrl ? link('search', f.searchUrl, 'application/opensearchdescription+xml') : '',
    f.nextUrl ? link('next', f.nextUrl, ACQUISITION_TYPE) : '',
    ...entries,
    '</feed>',
  ].join('\n');
}

export function buildFeed(opts: { selfUrl: string; startUrl: string; updated: string; entries: OpdsEntry[]; nextUrl?: string; title?: string; id?: string; searchUrl?: string }): string {
  return feedXml({ id: opts.id ?? 'urn:textus:catalog', title: opts.title ?? 'Textus library', selfUrl: opts.selfUrl, startUrl: opts.startUrl, updated: opts.updated, selfType: ACQUISITION_TYPE, searchUrl: opts.searchUrl, nextUrl: opts.nextUrl }, opts.entries.map(entryXml));
}

export function buildNavigationFeed(opts: { selfUrl: string; startUrl: string; updated: string; entries: OpdsNavEntry[]; title?: string; id?: string; searchUrl?: string }): string {
  return feedXml({ id: opts.id ?? 'urn:textus:catalog', title: opts.title ?? 'Textus library', selfUrl: opts.selfUrl, startUrl: opts.startUrl, updated: opts.updated, selfType: NAVIGATION_TYPE, searchUrl: opts.searchUrl }, opts.entries.map(navEntryXml));
}

// OpenSearch 1.1 description: `template` must contain {searchTerms}.
export function buildOpenSearch(template: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">',
    '<ShortName>Textus</ShortName>',
    '<Description>Search your Textus library</Description>',
    `<Url type="${xmlEscape(ACQUISITION_TYPE)}" template="${xmlEscape(template)}"/>`,
    '</OpenSearchDescription>',
  ].join('\n');
}
