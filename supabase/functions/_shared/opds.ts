// OPDS 1.2 acquisition feed (FR-SER-3, §8.5). Pure and Edge-safe so the function and Vitest
// (via shared/opds.ts) share one implementation.

export interface OpdsAcquisition {
  href: string;
  type: string;
  length?: number;
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
}

export function xmlEscape(text: string): string {
  // Also drops characters XML 1.0 forbids, which would make the whole feed unparseable.
  // deno-lint-ignore no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

const tag = (name: string, value: string | undefined) => (value ? `<${name}>${xmlEscape(value)}</${name}>` : '');

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
    ...e.acquisitions.map((a) => `<link rel="http://opds-spec.org/acquisition" type="${xmlEscape(a.type)}" href="${xmlEscape(a.href)}"${a.length ? ` length="${a.length}"` : ''}/>`),
    '</entry>',
  ].join('');
}

export function buildFeed(opts: { selfUrl: string; startUrl: string; updated: string; entries: OpdsEntry[]; nextUrl?: string }): string {
  const nav = (rel: string, href: string) => `<link rel="${rel}" href="${xmlEscape(href)}" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/">',
    '<id>urn:textus:catalog</id>',
    '<title>Textus library</title>',
    tag('updated', opts.updated),
    nav('self', opts.selfUrl),
    nav('start', opts.startUrl),
    opts.nextUrl ? nav('next', opts.nextUrl) : '',
    ...opts.entries.map(entryXml),
    '</feed>',
  ].join('\n');
}
