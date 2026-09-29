import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';
import { autoMapping, mapCsvRows, parseCsvImport, parseDoiList, readCsvTable } from './importRows';

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
    expect(parseCsvImport('isbn\nx').errors[0].message).toContain('title');
  });
});

describe('parseDoiList', () => {
  it('normalizes, dedupes and flags invalid lines', () => {
    const { dois, errors } = parseDoiList('10.1038/NATURE12373\n\nhttps://doi.org/10.1038/nature12373\nnot a doi');
    expect(dois).toEqual(['10.1038/nature12373']);
    expect(errors).toEqual([{ line: 4, message: '"not a doi" is not a valid DOI.' }]);
  });
});

describe('column mapping', () => {
  const table = readCsvTable('Name,By,Published,DOI number,Labels\nDune,Frank Herbert,1965,,sf; classic\n');

  it('recognises common header variants', () => {
    expect(autoMapping(readCsvTable('Name,By,Published,ISBN number,Labels').header)).toMatchObject({ title: 0, authors: 1, year: 2, isbn: 3, tags: 4 });
  });

  it('guesses columns from header names and aliases, leaving the rest unmapped', () => {
    const m = autoMapping(['Title', 'author', 'Date', 'doi', 'Tag', 'Notes']);
    expect(m).toMatchObject({ title: 0, authors: 1, year: 2, doi: 3, tags: 4, isbn: -1, publisher: -1 });
  });

  it('maps by the user-chosen columns, not the header names', () => {
    const { rows, errors } = mapCsvRows(table.body, { title: 0, authors: 1, year: 2, publisher: -1, doi: -1, isbn: -1, type: -1, language: -1, tags: 4 });
    expect(errors).toEqual([]);
    expect(rows[0].data).toMatchObject({ title: 'Dune', authors: 'Frank Herbert', year: '1965', tags: 'sf; classic', type: 'book' });
  });

  it('reports a row whose mapped title is empty', () => {
    const { errors } = mapCsvRows([['', 'x']], { title: 0, authors: 1, year: -1, publisher: -1, doi: -1, isbn: -1, type: -1, language: -1, tags: -1 });
    expect(errors[0]).toMatchObject({ line: 2 });
  });
});
