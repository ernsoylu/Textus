import type { SupabaseClient } from '@supabase/supabase-js';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { DOMParser, type Element, type Node } from '@xmldom/xmldom';
import { readCentralDirectory, readEntry } from './epub.ts';
import { checked, boundedFetch } from '../_shared/budget.ts';

export interface Passage { ordinal: number; content: string; page?: number; page_label?: string; section?: number; cfi?: string }
interface IndexJob { id: string; user_id: string | null; claim_generation: number; payload: Record<string, unknown> }
const MAX_BUFFER = 25_000_000;
const MAX_RANGE_BYTES = 24_000_000;
const MAX_PASSAGES = 128;
class ParserLimit extends Error {}
export function chunks(text: string): string[] {
  const clean = text.replaceAll('\u0000', '').replace(/\s+/gu, ' ').trim();
  const result = [];
  for (let from = 0; from < clean.length;) {
    let end = Math.min(clean.length, from + 2000);
    const space = clean.lastIndexOf(' ', end);
    if (end < clean.length && space > from + 1000) end = space;
    if (end < clean.length && /[\uD800-\uDBFF]/.test(clean[end - 1])) end--;
    result.push(clean.slice(from, end).trim());
    from = end;
  }
  return result;
}
function xml(markup: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(markup)) throw new ParserLimit('EPUB declarations require a different parser');
  let tags = 0;
  for (let at = markup.indexOf('<'); at >= 0; at = markup.indexOf('<', at + 1)) {
    if (++tags > 10000) throw new ParserLimit('EPUB markup exceeds the node limit');
  }
  return new DOMParser({ onError: (level) => { if (level !== 'warning') throw new Error('Malformed EPUB XML'); } }).parseFromString(markup, 'application/xml');
}
function elements(node: Node): Element[] { return Array.from(node.childNodes).filter((n): n is Element => n.nodeType === 1); }
function cfiPath(element: Element): string {
  const parent = element.parentNode;
  if (!parent || parent.nodeType === 9) return '';
  return cfiPath(parent as Element) + '/' + (2 * (elements(parent).indexOf(element) + 1));
}
function visibleText(node: Node): string {
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue ?? '';
  if (node.nodeType === 1 && ['script', 'style', 'head'].includes((node as Element).localName ?? '')) return '';
  return Array.from(node.childNodes).map(visibleText).join(' ');
}
export function epubSections(bytes: Uint8Array) {
  const entries = readCentralDirectory(bytes);
  const read = (name: string) => {
    const entry = entries.find((e) => e.name === name);
    const raw = entry && readEntry(bytes, entry);
    if (!raw) throw new ParserLimit('EPUB entry exceeds the 2 MB parser limit or is unsupported');
    return new TextDecoder().decode(raw);
  };
  const container = xml(read('META-INF/container.xml'));
  const path = container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
  if (!path) throw new Error('EPUB package missing');
  const opf = xml(read(path));
  const spine = opf.getElementsByTagName('spine')[0];
  if (!spine) throw new Error('EPUB spine missing');
  const manifest = Array.from(opf.getElementsByTagName('item'));
  const sections = elements(spine).filter((el) => el.localName === 'itemref');
  if (sections.length > 10000) throw new ParserLimit('EPUB spine exceeds the section limit');
  return sections.map((ref, section) => {
    const item = manifest.find((el) => el.getAttribute('id') === ref.getAttribute('idref'));
    const href = item?.getAttribute('href');
    if (!href) throw new Error('EPUB manifest item missing');
    const url = new URL(href, new URL(path, 'https://epub.invalid/'));
    if (url.origin !== 'https://epub.invalid') throw new Error('External EPUB spine item');
    return { section, read: () => {
      const document = xml(read(decodeURIComponent(url.pathname.slice(1))));
      const body = document.getElementsByTagName('body')[0];
      if (!body) throw new Error('EPUB body missing');
      // Section-start CFIs use the actual OPF/body paths, rather than assuming /6 or /4.
      return { text: visibleText(body), cfi: `epubcfi(${cfiPath(ref)}!${cfiPath(body)}:0)` };
    } };
  });
}

async function pdfDocument(url: string) {
  let received = 0;
  const readRange = async (begin: number, end: number) => {
    if (received + end - begin > MAX_RANGE_BYTES) throw new ParserLimit('PDF range budget exceeded; partial text retained');
    const response = await boundedFetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` }, signal: AbortSignal.timeout(15_000) });
    if (response.status !== 206 || !response.headers.get('content-range')?.startsWith(`bytes ${begin}-`)) { await response.body?.cancel(); throw new ParserLimit('Storage does not support bounded PDF ranges'); }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > end - begin) throw new ParserLimit('Oversized PDF range');
    received += buffer.byteLength;
    return new Uint8Array(buffer);
  };
  // HEAD yields the immutable object's length without downloading its bytes.
  const head = await boundedFetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
  const length = Number(head.headers.get('content-length'));
  if (!head.ok || !Number.isSafeInteger(length) || length <= 0) throw new Error('PDF size unavailable');
  const initial = await readRange(0, Math.min(length, 65536));
  class Ranges extends pdfjs.PDFDataRangeTransport {
    override requestDataRange(begin: number, end: number) {
      readRange(begin, end).then((data) => this.onDataRange(begin, data)).catch((e) => task.destroy().finally(() => rejectRange(e)));
    }
  }
  let rejectRange: (error: unknown) => void = () => {};
  const rangeFailure = new Promise<never>((_resolve, reject) => { rejectRange = reject; });
  const range = new Ranges(length, initial);
  const task = pdfjs.getDocument({ range, disableAutoFetch: true, disableStream: true, rangeChunkSize: 65536, useSystemFonts: false, maxImageSize: 0 });
  const timeout = setTimeout(() => { rejectRange(new ParserLimit('PDF parsing exceeded the time budget')); void task.destroy(); }, 35_000);
  try {
    const doc = await Promise.race([task.promise, rangeFailure]);
    return { doc, wait: <T>(promise: Promise<T>) => Promise.race([promise, rangeFailure]), destroy: async () => { clearTimeout(timeout); await task.destroy(); } };
  } catch (error) { clearTimeout(timeout); await task.destroy(); throw error; }
}

export async function indexPassages(admin: SupabaseClient, job: IndexJob) {
  const assetId = job.payload.asset_id;
  const asset = await checked(admin.from('assets').select('id,user_id,bucket,storage_path,file_size,file_format,metadata').eq('id', assetId).eq('user_id', job.user_id!).is('deleting_at', null).maybeSingle());
  if (!asset || asset.metadata?.passage_index?.version !== job.payload.index_version) return { checkpointed: true, committed: false };
  const from = Number(job.payload.from ?? 0);
  let done = from, total = Number(asset.metadata.passage_index.total ?? 0), ordinal = Number(job.payload.ordinal ?? 0);
  let reason: string | null = asset.metadata.passage_index.reason ?? null;
  const passages: Passage[] = [];
  const started = Date.now();
  try {
    if (asset.file_format === 'epub') {
      if (asset.file_size > MAX_BUFFER) throw new ParserLimit('EPUB exceeds the 25 MB parser limit');
      const file = await checked(admin.storage.from(asset.bucket).download(asset.storage_path));
      if (!file || file.size > MAX_BUFFER) throw new ParserLimit('EPUB exceeds the parser limit');
      const sections = epubSections(new Uint8Array(await file.arrayBuffer()));
      total = sections.length;
      for (const section of sections.slice(from, from + 4)) {
        const result = section.read();
        const parts = chunks(result.text);
        if (parts.length > MAX_PASSAGES) { reason = 'A section exceeds the passage batch limit; partial text retained'; parts.length = MAX_PASSAGES; }
        if (passages.length + parts.length > MAX_PASSAGES && done > from) break;
        passages.push(...parts.map((content) => ({ ordinal: ordinal++, section: section.section, cfi: result.cfi, content })));
        done++;
        if (Date.now() - started > 25_000) break;
      }
    } else if (asset.file_format === 'pdf') {
      const signed = await checked(admin.storage.from(asset.bucket).createSignedUrl(asset.storage_path, 120));
      const task = await pdfDocument(signed!.signedUrl);
      try {
        total = task.doc.numPages;
        const labels = await task.wait(task.doc.getPageLabels()).catch(() => null);
        for (let page = from + 1; page <= Math.min(total, from + 6); page++) {
          const pdfPage = await task.wait(task.doc.getPage(page));
          const text = await task.wait(pdfPage.getTextContent());
          const parts = chunks(text.items.map((item) => 'str' in item ? item.str : '').join(' '));
          if (parts.length > MAX_PASSAGES) { reason = 'A page exceeds the passage batch limit; partial text retained'; parts.length = MAX_PASSAGES; }
          if (passages.length + parts.length > MAX_PASSAGES && done > from) break;
          passages.push(...parts.map((content) => ({ ordinal: ordinal++, page, ...(labels?.[page - 1] ? { page_label: labels[page - 1] } : {}), content })));
          pdfPage.cleanup();
          done = page;
          if (Date.now() - started > 25_000) break;
        }
      } finally { await task.destroy(); }
    } else throw new ParserLimit('Unsupported format');
  } catch (error) {
    const limit = error instanceof Error && error.name === 'PasswordException' ? new ParserLimit('Encrypted PDF needs an unlocked copy for indexing') : error;
    if (!(limit instanceof ParserLimit)) throw error;
    reason = limit.message;
    total = Math.max(total, done);
  }
  const previous = Number(asset.metadata.passage_index.passages ?? 0);
  const status = reason ? (done < total && passages.length ? 'indexing' : previous + passages.length ? 'partial' : 'not_indexable')
    : done < total ? 'indexing' : previous + passages.length ? 'complete' : 'no_text';
  const committed = await checked(admin.rpc('commit_passage_batch', { p_job: job.id, p_generation: job.claim_generation, p_passages: passages, p_done: done, p_total: total, p_status: status, p_reason: reason }));
  return { checkpointed: true, committed };
}
