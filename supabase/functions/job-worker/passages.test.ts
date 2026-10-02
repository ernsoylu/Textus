import { textPdf } from '../../tests/fixtures/pdf.ts';
import { createClient } from '@supabase/supabase-js';
import { chunks, concurrencyLimit, epubSections, indexPassages } from './passages.ts';
function zip(files: [string, string][]) {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, value] of files) {
    const filename = encoder.encode(name), content = encoder.encode(value);
    const header = new Uint8Array(30 + filename.length + content.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint32(18, content.length, true); view.setUint32(22, content.length, true); view.setUint16(26, filename.length, true);
    header.set(filename, 30); header.set(content, 30 + filename.length);
    const directory = new Uint8Array(46 + filename.length), dir = new DataView(directory.buffer);
    dir.setUint32(0, 0x02014b50, true); dir.setUint32(20, content.length, true); dir.setUint32(24, content.length, true); dir.setUint16(28, filename.length, true); dir.setUint32(42, offset, true); directory.set(filename, 46);
    local.push(header); central.push(directory); offset += header.length;
  }
  const end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true); view.setUint32(12, central.reduce((sum, part) => sum + part.length, 0), true); view.setUint32(16, offset, true);
  const parts = [...local, ...central, end], result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
Deno.test('EPUB 2 XHTML DOCTYPEs and named entities parse; entity declarations stay refused', () => {
  const book = (chapter: string) => epubSections(zip([
    ['META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'],
    ['book.opf', '<package><metadata/><manifest><item id="c" href="c.xhtml"/></manifest><spine><itemref idref="c"/></spine></package>'],
    ['c.xhtml', chapter],
  ]))[0].read();
  const text = book('<?xml version="1.0"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><p>Heat&nbsp;transfer &mdash; entropy</p></body></html>').text;
  if (!text.includes('Heat\u00a0transfer \u2014 entropy')) throw new Error(`XHTML entities not resolved: ${text}`);
  let refused = false;
  try { book('<!DOCTYPE x [<!ENTITY a "aaaa">]><html><body>&a;</body></html>'); } catch { refused = true; }
  if (!refused) throw new Error('entity declarations must be refused');
});
Deno.test('EPUB follows the OPF spine and produces real element CFIs; chunks retain Unicode', () => {
  const sections = epubSections(zip([
    ['META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'],
    ['OPS/b.xhtml', '<html><head/><body><p>Second chapter güneş enerjisi</p></body></html>'],
    ['OPS/book.opf', '<package><metadata/><manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>'],
    ['OPS/a.xhtml', '<html><head/><body><p>First chapter</p></body></html>'],
  ]));
  if (!sections[0].read().text.includes('First chapter') || !sections[1].read().text.includes('Second chapter')) throw new Error('ZIP order substituted for reading order');
  if (sections[1].read().cfi !== 'epubcfi(/6/4!/4:0)') throw new Error('incorrect OPF/body CFI');
  const text = '😀 güneş energy '.repeat(600);
  if (chunks(text).join(' ').replace(/\s+/g, ' ').trim() !== text.trim()) throw new Error('chunking lost words or Unicode');
});
Deno.test('PDF batches resume across all 120 pages through bounded signed ranges', async () => {
  const bytes = textPdf(120);
  const asset = { id: crypto.randomUUID(), user_id: crypto.randomUUID(), file_format: 'pdf', file_size: bytes.length, bucket: 'documents', storage_path: 'book.pdf', metadata: { passage_index: { version: 'test', done: 0, passages: 0, reason: null } } };
  const saved: { page: number; content: string }[] = [];
  let done = 0, status = '', ranges = 0;
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, async (req) => {
    const path = new URL(req.url).pathname;
    if (path === '/rest/v1/assets') return Response.json(asset);
    if (path.startsWith('/rest/v1/rpc/commit_passage_batch')) {
      const input = await req.json();
      saved.push(...input.p_passages); done = input.p_done; status = input.p_status;
      asset.metadata.passage_index.done = done; asset.metadata.passage_index.passages = saved.length;
      return Response.json(true);
    }
    if (req.method === 'POST' && path.startsWith('/storage/')) return Response.json({ signedURL: '/object/sign/documents/book.pdf?token=test' });
    if (req.method === 'HEAD') return new Response(null, { headers: { 'Content-Length': String(bytes.length) } });
    const match = req.headers.get('Range')?.match(/bytes=(\d+)-(\d+)/);
    if (!match) return new Response('Range required', { status: 400 });
    const begin = Number(match[1]), end = Number(match[2]); ranges++;
    return new Response(bytes.slice(begin, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${begin}-${end}/${bytes.length}`, 'Content-Length': String(end - begin + 1) } });
  });
  try {
    const admin = createClient(`http://127.0.0.1:${server.addr.port}`, 'test-key');
    const job = { id: crypto.randomUUID(), user_id: asset.user_id, claim_generation: 1, payload: { asset_id: asset.id, index_version: 'test', from: 0, ordinal: 0 } };
    await indexPassages(admin, job);
    if (done !== 96 || status !== 'indexing') throw new Error(`first batch ${done}/${status}`);
    job.payload.from = done; job.payload.ordinal = saved.length;
    await indexPassages(admin, job);
    if (Number(done) !== 120 || String(status) !== 'complete' || !saved.some((p) => p.page === 9 && p.content.includes('page 9')) || ranges < 2) throw new Error('resume or page-nine extraction failed');
  } finally { await server.shutdown(); }
});

Deno.test('a damaged xref is repaired by reading the file through bounded ranges', async () => {
  // Point startxref at garbage so pdf.js must rebuild the xref by reading every chunk of the file.
  const good = new TextDecoder().decode(textPdf(40));
  const padded = good.replace('%PDF-1.4\n', `%PDF-1.4\n${'%padding\n'.repeat(120_000)}`);
  const bytes = new TextEncoder().encode(padded.replace(/startxref\n\d+/, 'startxref\n9'));
  const asset = { id: crypto.randomUUID(), user_id: crypto.randomUUID(), file_format: 'pdf', file_size: bytes.length, bucket: 'documents', storage_path: 'damaged.pdf', metadata: { passage_index: { version: 'test', done: 0, passages: 0, reason: null } } };
  let inFlight = 0, peak = 0, ranges = 0, committed: { p_done: number; p_status: string } | null = null;
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, async (req) => {
    const path = new URL(req.url).pathname;
    if (path === '/rest/v1/assets') return Response.json(asset);
    if (path.startsWith('/rest/v1/rpc/commit_passage_batch')) { committed = await req.json(); return Response.json(true); }
    if (req.method === 'POST' && path.startsWith('/storage/')) return Response.json({ signedURL: '/object/sign/documents/damaged.pdf?token=test' });
    if (req.method === 'HEAD') return new Response(null, { headers: { 'Content-Length': String(bytes.length) } });
    const match = req.headers.get('Range')?.match(/bytes=(\d+)-(\d+)/);
    if (!match) return new Response('Range required', { status: 400 });
    inFlight++; ranges++; peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    inFlight--;
    const begin = Number(match[1]), end = Number(match[2]);
    return new Response(bytes.slice(begin, end + 1), { status: 206, headers: { 'Content-Range': `bytes ${begin}-${end}/${bytes.length}`, 'Content-Length': String(end - begin + 1) } });
  });
  try {
    const admin = createClient(`http://127.0.0.1:${server.addr.port}`, 'test-key');
    await indexPassages(admin, { id: crypto.randomUUID(), user_id: asset.user_id, claim_generation: 1, payload: { asset_id: asset.id, index_version: 'test', from: 0, ordinal: 0 } });
    if (!committed || ranges < 5) throw new Error(`repair did not commit a batch over several ranges (${ranges})`);
    if (peak > 4) throw new Error(`${peak} range requests were in flight`);
  } finally { await server.shutdown(); }
});

Deno.test('range fetches run at most four at a time, in order', async () => {
  const limit = concurrencyLimit(4);
  let inFlight = 0, peak = 0;
  const order: number[] = [];
  await Promise.all(Array.from({ length: 20 }, (_, i) => limit(async () => {
    inFlight++; peak = Math.max(peak, inFlight); order.push(i);
    await new Promise((resolve) => setTimeout(resolve, 3));
    inFlight--;
  })));
  if (peak !== 4 || order.length !== 20 || order.some((n, i) => n !== i)) throw new Error(`peak ${peak}, order ${order}`);
});
