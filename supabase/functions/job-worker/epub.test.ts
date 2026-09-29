import { deflateRawSync } from 'node:zlib';
import { extractEpub, identifierSuggestions } from './epub.ts';

function zip(name: string, content: string): Uint8Array {
  const encoder = new TextEncoder();
  const filename = encoder.encode(name);
  const plain = encoder.encode(content);
  const compressed = deflateRawSync(plain);
  const local = new Uint8Array(30 + filename.length + compressed.length);
  const l = new DataView(local.buffer);
  l.setUint32(0, 0x04034b50, true);
  l.setUint16(8, 8, true);
  l.setUint32(18, compressed.length, true);
  l.setUint32(22, plain.length, true);
  l.setUint16(26, filename.length, true);
  local.set(filename, 30);
  local.set(compressed, 30 + filename.length);
  const central = new Uint8Array(46 + filename.length);
  const c = new DataView(central.buffer);
  c.setUint32(0, 0x02014b50, true);
  c.setUint16(10, 8, true);
  c.setUint32(20, compressed.length, true);
  c.setUint32(24, plain.length, true);
  c.setUint16(28, filename.length, true);
  central.set(filename, 46);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, 1, true);
  e.setUint16(10, 1, true);
  e.setUint32(12, central.length, true);
  e.setUint32(16, local.length, true);
  const bytes = new Uint8Array(local.length + central.length + end.length);
  bytes.set(local);
  bytes.set(central, local.length);
  bytes.set(end, local.length + central.length);
  return bytes;
}

Deno.test('EPUB OPF and identifier suggestions', () => {
  const epub = zip('OEBPS/content.opf', '<package><dc:title>Sample book</dc:title><dc:creator>Jane Writer</dc:creator><dc:identifier>ISBN 9780261103252</dc:identifier></package>');
  const result = extractEpub(epub);
  if (result.title !== 'Sample book' || result.author !== 'Jane Writer') throw new Error('OPF metadata lost');
  const suggestions = identifierSuggestions(result.text, '10.1000/test.epub');
  if (!suggestions.some((id) => id.scheme === 'isbn' && id.value === '9780261103252') || !suggestions.some((id) => id.scheme === 'doi' && id.value === '10.1000/test.epub')) throw new Error('identifiers missing');
});
