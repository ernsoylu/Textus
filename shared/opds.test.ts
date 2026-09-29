import { describe, expect, it } from 'vitest';
import { buildFeed, buildNavigationFeed, buildOpenSearch, xmlEscape } from './opds';

describe('OPDS feed', () => {
  it('escapes XML and drops illegal control characters', () => {
    expect(xmlEscape('A & <B> "c"\u0001')).toBe('A &amp; &lt;B&gt; &quot;c&quot;');
  });

  it('builds an acquisition entry with a cover and a next link', () => {
    const xml = buildFeed({
      selfUrl: 'https://x/opds/all', startUrl: 'https://x/opds', updated: '2026-01-01T00:00:00Z', nextUrl: 'https://x/opds/all?page=2', searchUrl: 'https://x/opds/opensearch.xml',
      entries: [{ id: 'abc', title: 'Dune & Co', updated: '2026-01-01T00:00:00Z', authors: ['Frank Herbert'], identifiers: ['urn:isbn:9780441172719'], cover: { href: 'https://x/opds/cover/9', type: 'image/png' }, acquisitions: [{ href: 'https://x/opds/download/1', type: 'application/epub+zip', length: 10 }] }],
    });
    expect(xml).toContain('<title>Dune &amp; Co</title>');
    expect(xml).toContain('<id>urn:uuid:abc</id>');
    expect(xml).toContain('rel="http://opds-spec.org/acquisition" href="https://x/opds/download/1" type="application/epub+zip" length="10"');
    expect(xml).toContain('rel="http://opds-spec.org/image" href="https://x/opds/cover/9" type="image/png"');
    expect(xml).toContain('rel="http://opds-spec.org/image/thumbnail"');
    expect(xml).toContain('rel="next"');
    expect(xml).toContain('rel="search" href="https://x/opds/opensearch.xml" type="application/opensearchdescription+xml"');
    expect(xml).toContain('<dc:identifier>urn:isbn:9780441172719</dc:identifier>');
  });

  it('builds a navigation feed whose entries point at sub-feeds', () => {
    const xml = buildNavigationFeed({
      selfUrl: 'https://x/opds', startUrl: 'https://x/opds', updated: '2026-01-01T00:00:00Z',
      entries: [
        { id: 'urn:textus:all', title: 'All titles', updated: '2026-01-01T00:00:00Z', href: 'https://x/opds/all', kind: 'acquisition' },
        { id: 'urn:textus:collections', title: 'Collections & shelves', summary: 'Your shelves', updated: '2026-01-01T00:00:00Z', href: 'https://x/opds/collections', kind: 'navigation' },
      ],
    });
    expect(xml).toContain('kind=navigation');
    expect(xml).toContain('rel="subsection" href="https://x/opds/all" type="application/atom+xml;profile=opds-catalog;kind=acquisition"');
    expect(xml).toContain('rel="subsection" href="https://x/opds/collections" type="application/atom+xml;profile=opds-catalog;kind=navigation"');
    expect(xml).toContain('<title>Collections &amp; shelves</title>');
  });

  it('describes the search URL for OpenSearch clients', () => {
    const xml = buildOpenSearch('https://x/opds/search?q={searchTerms}');
    expect(xml).toContain('template="https://x/opds/search?q={searchTerms}"');
    expect(xml).toContain('<OpenSearchDescription');
  });
});
