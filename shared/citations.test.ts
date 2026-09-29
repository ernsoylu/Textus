import { describe, expect, it } from 'vitest';
import { buildSource, toBibtex, toCslJson, toRis, type CitationSource, type RecordRowForCitation } from './citations';

const src = (over: Partial<CitationSource> = {}): CitationSource => ({
  id: 'r1', workType: 'article', recordType: 'article_version', title: 'A study of {things} & more', authors: [{ family: 'Smith', given: 'Jane' }, { literal: 'ACME Lab' }],
  editors: [], translators: [], date: '2020-05-01', pages: '12-20', volume: '3', issue: '2', identifiers: [{ scheme: 'doi', value: '10.1/abc' }], container: { title: 'Journal of X', editors: [] }, ...over,
});

describe('BibTeX', () => {
  it('escapes special characters and formats names, pages and journal', () => {
    const out = toBibtex([src()]);
    expect(out).toContain('@article{smith2020study,');
    expect(out).toContain('title = {A study of \\{things\\} \\& more}');
    expect(out).toContain('author = {Smith, Jane and {ACME Lab}}');
    expect(out).toContain('journal = {Journal of X}');
    expect(out).toContain('pages = {12--20}');
    expect(out).toContain('doi = {10.1/abc}');
  });
  it('keeps keys unique', () => {
    const [a, b] = toBibtex([src(), src({ id: 'r2' })]).match(/@article\{([^,]+),/g)!;
    expect(a).not.toBe(b);
  });
});

describe('RIS', () => {
  it('emits tagged lines and splits pages', () => {
    const out = toRis([src()]);
    expect(out).toContain('TY  - JOUR');
    expect(out).toContain('AU  - Smith, Jane');
    expect(out).toContain('SP  - 12');
    expect(out).toContain('EP  - 20');
    expect(out.trim().endsWith('ER  -')).toBe(true);
  });
});

describe('CSL-JSON', () => {
  it('maps types and uses container editors for chapters without copying them', () => {
    const [item] = JSON.parse(toCslJson([src({ workType: 'chapter', recordType: 'chapter', container: { title: 'Handbook', editors: [{ family: 'Ed', given: 'Ann' }], publisher: 'Pub' } })]));
    expect(item.type).toBe('chapter');
    expect(item['container-title']).toBe('Handbook');
    expect(item.editor).toEqual([{ family: 'Ed', given: 'Ann' }]);
    expect(item.publisher).toBe('Pub');
    expect(item.DOI).toBe('10.1/abc');
    expect(item.issued).toEqual({ 'date-parts': [[2020, 5, 1]] });
  });
});

describe('buildSource', () => {
  const contributor = (family: string) => ({ kind: 'person', display_name: family, family_name: family, given_names: null, particle: null, suffix: null });
  const row = (credits: RecordRowForCitation['record_contributors']): RecordRowForCitation => ({
    id: 'r', title: null, record_type: 'edition', publication_date: '1999-01-01', publication_date_precision: 'year', publisher: null, edition: null, volume: null,
    issue_number: null, pages: null, metadata: {}, works: { title: 'Book', subtitle: null, abstract: null, language: null, work_type: 'book' }, identifiers: [], record_contributors: credits, container: null,
  });
  it('falls back to editors, then compilers, then translators (FR-CONTRIB-4)', () => {
    expect(buildSource(row([{ role: 'editor', position: 0, contributors: contributor('Ed') }])).editors).toHaveLength(1);
    expect(buildSource(row([{ role: 'editor', position: 0, contributors: contributor('Ed') }])).authors).toHaveLength(0);
    expect(buildSource(row([{ role: 'translator', position: 0, contributors: contributor('Tr') }, { role: 'compiler', position: 0, contributors: contributor('Co') }])).authors[0].family).toBe('Co');
    expect(buildSource(row([{ role: 'translator', position: 0, contributors: contributor('Tr') }])).authors[0].family).toBe('Tr');
  });
  it('trims the date to its precision', () => {
    expect(buildSource(row([])).date).toBe('1999');
  });
});
