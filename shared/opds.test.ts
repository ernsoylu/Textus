import { describe, expect, it } from 'vitest';
import { buildFeed, xmlEscape } from './opds';

describe('OPDS feed', () => {
  it('escapes XML and drops illegal control characters', () => {
    expect(xmlEscape('A & <B> "c"\u0001')).toBe('A &amp; &lt;B&gt; &quot;c&quot;');
  });
  it('builds an acquisition entry and a next link', () => {
    const xml = buildFeed({
      selfUrl: 'https://x/opds', startUrl: 'https://x/opds', updated: '2026-01-01T00:00:00Z', nextUrl: 'https://x/opds?page=2',
      entries: [{ id: 'abc', title: 'Dune & Co', updated: '2026-01-01T00:00:00Z', authors: ['Frank Herbert'], identifiers: ['urn:isbn:9780441172719'], acquisitions: [{ href: 'https://x/opds/download/1', type: 'application/epub+zip', length: 10 }] }],
    });
    expect(xml).toContain('<title>Dune &amp; Co</title>');
    expect(xml).toContain('<id>urn:uuid:abc</id>');
    expect(xml).toContain('rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="https://x/opds/download/1" length="10"');
    expect(xml).toContain('rel="next"');
    expect(xml).toContain('<dc:identifier>urn:isbn:9780441172719</dc:identifier>');
  });
});
