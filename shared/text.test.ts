import { describe, expect, it } from 'vitest';
import { stripTags, stripTrailing, xmlElementText } from './text';

describe('stripTags', () => {
  it('removes tags and keeps an unclosed "<"', () => {
    expect(stripTags('a <b>bold</b> c', ' ')).toBe('a  bold  c');
    expect(stripTags('1 < 2 and <i>x</i>')).toBe('1 x');
    expect(stripTags('x < y')).toBe('x < y');
  });
  it('is linear on hostile input', () => {
    const start = Date.now();
    stripTags('<'.repeat(200_000));
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe('xmlElementText', () => {
  it('finds an element with attributes and is literal about the name', () => {
    expect(xmlElementText('<dc:titles>no</dc:titles><dc:title id="t">Dune</dc:title>', 'dc:title')).toBe('Dune');
    expect(xmlElementText('<DC:Title>X</DC:Title>', 'dc:title', true)).toBe('X');
    expect(xmlElementText('<a>open only', 'a')).toBeUndefined();
    expect(xmlElementText('<a>x</a>', 'b')).toBeUndefined();
  });
});

describe('stripTrailing', () => {
  it('strips trailing characters only', () => {
    expect(stripTrailing('10.1/x).]', '.)]')).toBe('10.1/x');
    expect(stripTrailing('a.b', '.')).toBe('a.b');
  });
});
