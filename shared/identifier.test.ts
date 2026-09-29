import { describe, it, expect } from 'vitest';
import { parseIdentifier, parseAuthorityIdentifier } from './identifier';

describe('isbn (§6.2)', () => {
  it('accepts a valid ISBN-13 and normalizes to digits only', () => {
    const r = parseIdentifier('isbn', '978-0-13-468599-1');
    expect(r).toMatchObject({ ok: true, normalized: '9780134685991' });
  });

  it('accepts a valid ISBN-10 with a numeric check digit and converts to ISBN-13', () => {
    const r = parseIdentifier('isbn', '0-13-468599-7');
    expect(r).toMatchObject({ ok: true, normalized: '9780134685991' });
  });

  it('accepts a valid ISBN-10 with an X check digit', () => {
    const r = parseIdentifier('isbn', '020161622X');
    expect(r.ok).toBe(true);
  });

  it('accepts an optional ISBN prefix and lowercase x', () => {
    const r = parseIdentifier('isbn', 'ISBN 020161622x');
    expect(r.ok).toBe(true);
  });

  it('rejects a wrong ISBN-10 check digit', () => {
    expect(parseIdentifier('isbn', '0201616221')).toEqual({ ok: false, reason: 'invalid_check_digit' });
  });

  it('rejects a wrong ISBN-13 check digit', () => {
    expect(parseIdentifier('isbn', '9780134685992')).toEqual({ ok: false, reason: 'invalid_check_digit' });
  });

  it('rejects the wrong length or non-digit characters', () => {
    expect(parseIdentifier('isbn', '12345')).toEqual({ ok: false, reason: 'invalid_format' });
    expect(parseIdentifier('isbn', '978013468599A')).toEqual({ ok: false, reason: 'invalid_format' });
  });
});

describe('authority identifiers', () => {
  it('validates ORCID and ISNI check digits', () => {
    expect(parseAuthorityIdentifier('orcid', 'https://orcid.org/0000-0002-1825-0097')).toBe('0000-0002-1825-0097');
    expect(parseAuthorityIdentifier('orcid', '0000-0002-1825-0098')).toBeNull();
    expect(parseAuthorityIdentifier('isni', '0000 0001 2281 955X')).toBe('000000012281955X');
  });
  it('normalizes authority URL forms', () => {
    expect(parseAuthorityIdentifier('openlibrary', '/authors/OL23919A')).toBe('OL23919A');
    expect(parseAuthorityIdentifier('wikidata', 'https://www.wikidata.org/wiki/Q42')).toBe('Q42');
  });
});

describe('doi (§6.2)', () => {
  it('accepts a bare DOI', () => {
    expect(parseIdentifier('doi', '10.1038/nature12373')).toMatchObject({ ok: true, normalized: '10.1038/nature12373' });
  });

  it('accepts a doi: prefix', () => {
    expect(parseIdentifier('doi', 'doi:10.1038/nature12373')).toMatchObject({ ok: true, normalized: '10.1038/nature12373' });
  });

  it('accepts a doi.org or dx.doi.org URL', () => {
    expect(parseIdentifier('doi', 'https://doi.org/10.1038/nature12373')).toMatchObject({ ok: true });
    expect(parseIdentifier('doi', 'https://dx.doi.org/10.1038/nature12373')).toMatchObject({ ok: true });
  });

  it('normalizes to lowercase (DOIs are case-insensitive)', () => {
    expect(parseIdentifier('doi', '10.1038/NATURE12373')).toMatchObject({ normalized: '10.1038/nature12373' });
  });

  it('rejects a registrant code shorter than 4 digits or a missing suffix', () => {
    expect(parseIdentifier('doi', '10.123/x')).toEqual({ ok: false, reason: 'invalid_format' });
    expect(parseIdentifier('doi', '10.1038/')).toEqual({ ok: false, reason: 'invalid_format' });
    expect(parseIdentifier('doi', 'not-a-doi')).toEqual({ ok: false, reason: 'invalid_format' });
  });
});

describe('issn (§6.2)', () => {
  it('accepts 8 digits or a hyphenated form', () => {
    expect(parseIdentifier('issn', '00280836')).toMatchObject({ ok: true, normalized: '0028-0836' });
    expect(parseIdentifier('issn', '0028-0836')).toMatchObject({ ok: true, normalized: '0028-0836' });
  });

  it('accepts and uppercases an X check digit', () => {
    expect(parseIdentifier('issn', '0000006x')).toMatchObject({ ok: true, normalized: '0000-006X' });
  });

  it('rejects a wrong check digit', () => {
    expect(parseIdentifier('issn', '0028-0837')).toEqual({ ok: false, reason: 'invalid_check_digit' });
  });

  it('rejects the wrong length', () => {
    expect(parseIdentifier('issn', '123')).toEqual({ ok: false, reason: 'invalid_format' });
  });
});

describe('arxiv (§6.2)', () => {
  it('accepts a bare id, with and without a version suffix', () => {
    expect(parseIdentifier('arxiv', '2301.12345')).toMatchObject({ ok: true, normalized: '2301.12345' });
    expect(parseIdentifier('arxiv', '2301.12345v2')).toMatchObject({ ok: true, normalized: '2301.12345', arxivVersion: 2 });
  });

  it('accepts an arXiv: prefix and an arxiv.org URL', () => {
    expect(parseIdentifier('arxiv', 'arXiv:2301.12345')).toMatchObject({ ok: true, normalized: '2301.12345' });
    expect(parseIdentifier('arxiv', 'https://arxiv.org/abs/2301.12345v3')).toMatchObject({ normalized: '2301.12345', arxivVersion: 3 });
  });

  it('accepts a 4-digit sequence number', () => {
    expect(parseIdentifier('arxiv', '2301.1234')).toMatchObject({ ok: true, normalized: '2301.1234' });
  });

  it('rejects the old hep-th/9901001-style id (§15 #4: not yet supported)', () => {
    expect(parseIdentifier('arxiv', 'hep-th/9901001')).toEqual({ ok: false, reason: 'invalid_format' });
  });

  it('rejects a malformed id', () => {
    expect(parseIdentifier('arxiv', '301.12345')).toEqual({ ok: false, reason: 'invalid_format' });
    expect(parseIdentifier('arxiv', '2301.123')).toEqual({ ok: false, reason: 'invalid_format' });
  });
});

describe('pmid (§6.2)', () => {
  it('accepts plain digits', () => {
    expect(parseIdentifier('pmid', '12345678')).toEqual({ ok: true, scheme: 'pmid', normalized: '12345678', original: '12345678' });
  });

  it('accepts a PMID: prefix', () => {
    expect(parseIdentifier('pmid', 'PMID: 12345678')).toMatchObject({ ok: true, normalized: '12345678' });
  });

  it('strips leading zeros', () => {
    expect(parseIdentifier('pmid', '00012345')).toMatchObject({ normalized: '12345' });
  });

  it('rejects non-digits and ids over 9 digits', () => {
    expect(parseIdentifier('pmid', '12a45')).toEqual({ ok: false, reason: 'invalid_format' });
    expect(parseIdentifier('pmid', '1234567890')).toEqual({ ok: false, reason: 'invalid_format' });
  });
});
