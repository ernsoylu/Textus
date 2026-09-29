import { describe, expect, it } from 'vitest';
import { sniff, sniffHead, TextProbe } from './sniff';

const bytes = (...parts: (number[] | string)[]) => Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const text = (s: string) => {
  const probe = new TextProbe();
  probe.push(new TextEncoder().encode(s));
  return probe;
};

// A zip local header: signature, 22 bytes of fixed fields, name length at 26, then the name.
const zip = (name: string, body = '') => {
  const header = new Uint8Array(30);
  header.set([0x50, 0x4b, 0x03, 0x04]);
  new DataView(header.buffer).setUint16(26, name.length, true);
  return bytes([...header], name, body);
};

// A PalmDB header with one record whose MOBI header carries `version`.
const palmdb = (version: number) => {
  const head = new Uint8Array(512);
  head.set([...'BOOKMOBI'].map((c) => c.charCodeAt(0)), 60);
  const view = new DataView(head.buffer);
  view.setUint16(76, 1);
  view.setUint32(78, 100); // record 0 starts at 100
  head.set([...'MOBI'].map((c) => c.charCodeAt(0)), 116); // 100 + 16
  view.setUint32(136, version); // MOBI header + 20
  return head;
};

describe('sniffHead', () => {
  it('recognises documents and images by their bytes', () => {
    expect(sniffHead(bytes('%PDF-1.7'))?.mimeType).toBe('application/pdf');
    expect(sniffHead(bytes([0xff, 0xd8, 0xff, 0xe0]))?.mimeType).toBe('image/jpeg');
    expect(sniffHead(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mimeType).toBe('image/png');
    expect(sniffHead(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))?.mimeType).toBe('image/webp');
    expect(sniffHead(bytes('<!DOCTYPE html><p>'))?.mimeType).toBe('text/html');
  });

  it('tells EPUB from a comic archive and rejects other zips', () => {
    expect(sniffHead(zip('mimetype', 'application/epub+zip'))?.mimeType).toBe('application/epub+zip');
    expect(sniffHead(zip('001.jpg'))?.mimeType).toBe('application/vnd.comicbook+zip');
    expect(sniffHead(zip('pages/'))?.mimeType).toBe('application/vnd.comicbook+zip');
    expect(sniffHead(zip('ComicInfo.xml'))?.mimeType).toBe('application/vnd.comicbook+zip');
    expect(sniffHead(zip('setup.exe'))).toBeNull();
    expect(sniffHead(zip('word/document.xml.bin'))).toBeNull();
  });

  it('tells MOBI from AZW3 by the MOBI header version', () => {
    expect(sniffHead(palmdb(6))?.mimeType).toBe('application/x-mobipocket-ebook');
    expect(sniffHead(palmdb(8))?.mimeType).toBe('application/vnd.amazon.ebook');
  });
});

describe('sniff', () => {
  it('accepts UTF-8 text with ordinary whitespace, even split across chunks', () => {
    const probe = new TextProbe();
    const encoded = new TextEncoder().encode('héllo\nwörld\t!');
    probe.push(encoded.subarray(0, 2)); // cuts the multi-byte "é" in half
    probe.push(encoded.subarray(2));
    expect(sniff(bytes('hello'), probe)?.mimeType).toBe('text/plain');
  });

  it('rejects control bytes, invalid UTF-8 and a truncated character', () => {
    expect(sniff(bytes('ab'), text('a\u0001b'))).toBeNull();
    const bad = new TextProbe();
    bad.push(Uint8Array.from([0xff, 0xfe, 0xfd]));
    expect(sniff(bytes('x'), bad)).toBeNull();
    const cut = new TextProbe();
    cut.push(Uint8Array.from([0x68, 0xc3])); // "h" then half of "é"
    expect(sniff(bytes('h'), cut)).toBeNull();
  });

  it('prefers a real signature over the text guess', () => {
    expect(sniff(bytes('%PDF-1.4'), text('%PDF-1.4'))?.mimeType).toBe('application/pdf');
  });
});
