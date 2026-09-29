import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { parseCsvImport, parseDoiList } from './importRows';

describe('parseCsv', () => {
  it('handles quotes, embedded commas/newlines and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi""\nthere"\r\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"\nthere']]);
  });
});

describe('parseCsvImport', () => {
  it('parses valid rows, applies aliases and defaults, and reports bad rows by line', () => {
    const { rows, errors } = parseCsvImport('Title,Author,Year,DOI\nDune,Frank Herbert,1965,\n,Nobody,2000,\nBad,X,20,\nDoi,X,2001,10.12/xyz\nOk,X,2001,10.1038/nature12373');
    expect(rows.map((r) => r.data.title)).toEqual(['Dune', 'Ok']);
    expect(rows[0].data).toMatchObject({ authors: 'Frank Herbert', type: 'book' });
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5]);
  });
  it('requires a title column', () => {
    expect(parseCsvImport('name\nx').errors[0].message).toContain('title');
  });
});

describe('parseDoiList', () => {
  it('normalizes, dedupes and flags invalid lines', () => {
    const { dois, errors } = parseDoiList('10.1038/NATURE12373\n\nhttps://doi.org/10.1038/nature12373\nnot a doi');
    expect(dois).toEqual(['10.1038/nature12373']);
    expect(errors).toEqual([{ line: 4, message: '"not a doi" is not a valid DOI.' }]);
  });
});
