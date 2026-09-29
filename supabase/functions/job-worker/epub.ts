import { inflateRawSync } from 'node:zlib';
import { parseIdentifier } from '../_shared/identifier.ts';
import { stripTags, stripTrailing, xmlElementText } from '../_shared/text.ts';

export function identifierSuggestions(text: string, filename = ''): { scheme: 'isbn' | 'doi'; value: string }[] {
  const found: { scheme: 'isbn' | 'doi'; value: string }[] = [];
  const source = `${filename} ${text}`;
  for (const match of source.matchAll(/(?:ISBN(?:-1[03])?[:\s]{0,3})?\d[-\d\s]{8,20}[\dX]|10\.\d{4,9}\/[^\s,;<>]+/gi)) {
    const raw = stripTrailing(match[0].trim(), '.)]');
    const scheme = raw.startsWith('10.') ? 'doi' : 'isbn';
    const parsed = parseIdentifier(scheme, raw);
    if (parsed.ok && !found.some((item) => item.scheme === scheme && item.value === parsed.normalized)) found.push({ scheme, value: parsed.normalized });
    if (found.length >= 10) break;
  }
  return found;
}

const MAX_ENTRY_BYTES = 2_000_000;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;

interface ZipEntry {
  name: string;
  method: number;
  compressed: number;
  uncompressed: number;
  local: number;
}

function zipReader(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { u16: (at: number) => view.getUint16(at, true), u32: (at: number) => view.getUint32(at, true) };
}

function readCentralDirectory(bytes: Uint8Array): ZipEntry[] {
  const { u16, u32 } = zipReader(bytes);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (u32(at) === END_OF_CENTRAL_DIRECTORY) { end = at; break; }
  }
  if (end < 0) throw new Error('invalid EPUB ZIP directory');
  let at = u32(end + 16);
  const count = Math.min(u16(end + 10), 10000);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || u32(at) !== CENTRAL_ENTRY) throw new Error('invalid EPUB ZIP entry');
    const nameLength = u16(at + 28);
    entries.push({
      name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      method: u16(at + 10),
      compressed: u32(at + 20),
      uncompressed: u32(at + 24),
      local: u32(at + 42),
    });
    at += 46 + nameLength + u16(at + 30) + u16(at + 32);
  }
  return entries;
}

// The entry's bytes, or null when it is too large, malformed, or uses an unsupported method.
// Sizes are checked from the central directory before anything is inflated.
function readEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array | null {
  const { u16, u32 } = zipReader(bytes);
  const { local, compressed, uncompressed, method } = entry;
  if (uncompressed > MAX_ENTRY_BYTES || compressed > MAX_ENTRY_BYTES || local + 30 > bytes.length || u32(local) !== LOCAL_ENTRY) return null;
  const start = local + 30 + u16(local + 26) + u16(local + 28);
  if (start + compressed > bytes.length) return null;
  const raw = bytes.subarray(start, start + compressed);
  let content: Uint8Array | null = null;
  if (method === 0) content = raw;
  else if (method === 8) content = inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
  return content && content.length <= MAX_ENTRY_BYTES ? content : null;
}

// Read only the small OPF/XHTML entries needed for suggestions. ZIP central-directory sizes
// are checked before inflation; document bytes themselves remain immutable.
export function extractEpub(bytes: Uint8Array): { text: string; title?: string; author?: string } {
  const decoder = new TextDecoder();
  let text = '';
  let opf = '';
  let chapters = 0;
  for (const entry of readCentralDirectory(bytes)) {
    const isOpf = /\.opf$/i.test(entry.name);
    if (!/\.(opf|xhtml|html|htm)$/i.test(entry.name) || (chapters >= 8 && !isOpf)) continue;
    const content = readEntry(bytes, entry);
    if (!content) continue;
    const markup = decoder.decode(content);
    if (isOpf) opf = markup;
    else { text += stripTags(markup, ' ').replaceAll('&amp;', '&').replace(/\s+/g, ' ') + '\n'; chapters++; }
  }
  const tag = (name: string) => xmlElementText(opf, `dc:${name}`, true)?.trim();
  text = `${stripTags(opf, ' ')}\n${text}`;
  return { text: text.slice(0, 200_000), title: tag('title'), author: tag('creator') };
}
