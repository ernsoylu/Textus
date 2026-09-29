import { inflateRawSync } from 'node:zlib';
import { parseIdentifier } from '../_shared/identifier.ts';

export function identifierSuggestions(text: string, filename = ''): { scheme: 'isbn' | 'doi'; value: string }[] {
  const found: { scheme: 'isbn' | 'doi'; value: string }[] = [];
  const source = `${filename} ${text}`;
  for (const match of source.matchAll(/(?:ISBN(?:-1[03])?\s*[:]?\s*)?(?:97[89][-\s]?)?\d[-\d\s]{8,20}[\dX]|10\.\d{4,9}\/[^\s,;<>]+/gi)) {
    const raw = match[0].trim().replace(/[.)\]]+$/, '');
    const scheme = raw.startsWith('10.') ? 'doi' : 'isbn';
    const parsed = parseIdentifier(scheme, raw);
    if (parsed.ok && !found.some((item) => item.scheme === scheme && item.value === parsed.normalized)) found.push({ scheme, value: parsed.normalized });
    if (found.length >= 10) break;
  }
  return found;
}

// Read only the small OPF/XHTML entries needed for suggestions. ZIP central-directory sizes
// are checked before inflation; document bytes themselves remain immutable.
export function extractEpub(bytes: Uint8Array): { text: string; title?: string; author?: string } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (u32(at) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw new Error('invalid EPUB ZIP directory');
  let at = u32(end + 16);
  const count = Math.min(u16(end + 10), 10000);
  const decoder = new TextDecoder();
  let text = '';
  let opf = '';
  let chapters = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || u32(at) !== 0x02014b50) throw new Error('invalid EPUB ZIP entry');
    const method = u16(at + 10);
    const compressed = u32(at + 20);
    const uncompressed = u32(at + 24);
    const nameLength = u16(at + 28);
    const extraLength = u16(at + 30);
    const commentLength = u16(at + 32);
    const local = u32(at + 42);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (!/\.(opf|xhtml|html|htm)$/i.test(name) || (chapters >= 8 && !/\.opf$/i.test(name))) continue;
    if (uncompressed > 2_000_000 || compressed > 2_000_000 || local + 30 > bytes.length || u32(local) !== 0x04034b50) continue;
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (start + compressed > bytes.length) continue;
    const raw = bytes.subarray(start, start + compressed);
    const content = method === 0 ? raw : method === 8 ? inflateRawSync(raw, { maxOutputLength: 2_000_000 }) : null;
    if (!content || content.length > 2_000_000) continue;
    const markup = decoder.decode(content);
    if (/\.opf$/i.test(name)) opf = markup;
    else { text += markup.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ') + '\n'; chapters++; }
  }
  const tag = (name: string) => new RegExp(`<dc:${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/dc:${name}>`, 'i').exec(opf)?.[1]?.trim();
  text = `${opf.replace(/<[^>]+>/g, ' ')}\n${text}`;
  return { text: text.slice(0, 200_000), title: tag('title'), author: tag('creator') };
}
