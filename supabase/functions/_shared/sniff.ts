// Content sniffing for uploads (CLAUDE.md invariant 6, NFR-SEC-4): the file type comes from the bytes,
// never from the client. Streaming-friendly — `sniffHead` needs only the first SNIFF_HEAD_BYTES, and plain
// text is judged incrementally by TextProbe — so a 500 MB upload is never held in memory.
// Pure and Edge-safe; re-exported by shared/sniff.ts for tests.
export const SNIFF_HEAD_BYTES = 262_144;

export interface Sniffed {
  mimeType: string;
}

const latin1 = (bytes: Uint8Array, start: number, end: number) => new TextDecoder('latin1').decode(bytes.subarray(start, end));
const startsWith = (bytes: Uint8Array, sig: number[]) => sig.length <= bytes.length && sig.every((b, i) => bytes[i] === b);

// PalmDB "BOOKMOBI" covers both MOBI and AZW3 (KF8). They differ in the MOBI header's file version: 8 is KF8.
// The first record's offset is in the record list at byte 78; if the head is too short to reach it, MOBI is assumed.
function palmDbMime(head: Uint8Array): string | null {
  if (head.length < 68 || latin1(head, 60, 68) !== 'BOOKMOBI') return null;
  const mobi = 'application/x-mobipocket-ebook';
  if (head.length < 82) return mobi;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const record0 = view.getUint32(78);
  const mobiHeader = record0 + 16; // after the 16-byte PalmDOC header
  if (mobiHeader + 24 > head.length || latin1(head, mobiHeader, mobiHeader + 4) !== 'MOBI') return mobi;
  return view.getUint32(mobiHeader + 20) === 8 ? 'application/vnd.amazon.ebook' : mobi;
}

// A comic archive is a zip whose first entry is an image, a folder or ComicInfo.xml. Any other zip is rejected
// rather than guessed at. (An EPUB is recognised first, by its leading "mimetype" entry.)
const COMIC_ENTRY = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?|jp2|xml)$|\/$/i;
function zipMime(head: Uint8Array): string | null {
  if (!startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || head.length < 30) return null;
  if (latin1(head, 0, 128).includes('mimetypeapplication/epub+zip')) return 'application/epub+zip';
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const nameEnd = 30 + view.getUint16(26, true);
  if (nameEnd > head.length) return null;
  return COMIC_ENTRY.test(latin1(head, 30, nameEnd)) ? 'application/vnd.comicbook+zip' : null;
}

export function sniffHead(head: Uint8Array): Sniffed | null {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return { mimeType: 'application/pdf' }; // %PDF
  if (startsWith(head, [0xff, 0xd8, 0xff])) return { mimeType: 'image/jpeg' };
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mimeType: 'image/png' };
  if (head.length >= 12 && latin1(head, 0, 4) === 'RIFF' && latin1(head, 8, 12) === 'WEBP') return { mimeType: 'image/webp' };
  // DjVu: "AT&TFORM", a length, then DJVU (one page) or DJVM (a bundled multi-page document).
  if (head.length >= 16 && latin1(head, 0, 8) === 'AT&TFORM' && ['DJVU', 'DJVM'].includes(latin1(head, 12, 16))) return { mimeType: 'image/vnd.djvu' };
  if (startsWith(head, [0x50, 0x4b])) {
    const zip = zipMime(head);
    return zip ? { mimeType: zip } : null;
  }
  const mobi = palmDbMime(head);
  if (mobi) return { mimeType: mobi };
  const text = new TextDecoder('utf-8', { fatal: false }).decode(head.subarray(0, 512)).trimStart().toLowerCase();
  if (text.startsWith('<!doctype html') || text.startsWith('<html')) return { mimeType: 'text/html' };
  return null;
}

// Plain text has no magic bytes: accept only a file that is valid UTF-8 all the way through with no control
// bytes outside common whitespace. Fed chunk by chunk, so it never needs the whole file.
export class TextProbe {
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private ok = true;

  push(chunk: Uint8Array): void {
    if (!this.ok) return;
    try {
      // deno-lint-ignore no-control-regex
      if (/[\x00-\x08\x0e-\x1f]/.test(this.decoder.decode(chunk, { stream: true }))) this.ok = false;
    } catch {
      this.ok = false;
    }
  }

  get isText(): boolean {
    if (!this.ok) return false;
    try {
      this.decoder.decode(); // a multi-byte character cut off at the very end is invalid too
      return true;
    } catch {
      return false;
    }
  }
}

export function sniff(head: Uint8Array, text: TextProbe): Sniffed | null {
  return sniffHead(head) ?? (text.isText ? { mimeType: 'text/plain' } : null);
}
