import { lookupAcrossProviders, provider, providersFor } from './index.ts';

Deno.test('provider parsers return real titles and typed failures', async () => {
  const original = globalThis.fetch;
  const fixtures: Record<string, unknown> = {
    '/books/OL33912545M.json': { title: 'The Lord of the Rings', publish_date: '2004', publishers: ['HarperCollins'], authors: [{ key: '/authors/OL26320A' }], covers: [123] },
    '/authors/OL26320A.json': { name: 'J. R. R. Tolkien' },
    '/works/10.1000%2Ftest': { message: { title: ['Paper title'], author: [{ given: 'Jane', family: 'Smith', ORCID: 'https://orcid.org/0000-0001-0002-0003' }], published: { 'date-parts': [[2024, 5, 1]] } } },
    '/api/query': '<feed><entry><title>Preprint title</title><author><name>John Smith</name></author></entry></feed>',
    '/graph/v1/paper/PMID%3A123': { title: 'Medical paper', authors: [{ name: 'A. Writer', authorId: '42' }] },
    '/books/v1/volumes': { items: [{ volumeInfo: { title: 'Book title', authors: ['Jane Smith'] } }] },
  };
  globalThis.fetch = ((input) => {
    const path = new URL(input.toString()).pathname;
    if (path === '/isbn/9780261103252.json') return Promise.resolve(new Response(null, { status: 302, headers: { location: '/books/OL33912545M.json' } }));
    const body = fixtures[path];
    return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body ?? {}), { status: body ? 200 : 404 }));
  }) as typeof fetch;
  try {
    for (const [name, id, expected] of [
      ['openlibrary', '9780261103252', 'The Lord of the Rings'],
      ['crossref', '10.1000/test', 'Paper title'],
      ['arxiv', '2401.00001', 'Preprint title'],
      ['semantic_scholar', 'PMID:123', 'Medical paper'],
      ['google_books', '9780261103252', 'Book title'],
    ]) {
      const result = await provider(name, id);
      if (result.kind !== 'success' || result.data.title !== expected) throw new Error(`${name}: ${JSON.stringify(result)}`);
    }
    const missing = await provider('crossref', '10.1000/missing');
    if (missing.kind !== 'not_found') throw new Error('missing result was not typed as not_found');
  } finally { globalThis.fetch = original; }
});

Deno.test('Internet Archive rescues ISBN lookups only after earlier providers fail', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = Deno.env.get('GOOGLE_BOOKS_API_KEY');
  const calls: string[] = [];
  const cached: Record<string, unknown>[] = [];
  const ctx = { supabaseAdmin: { from: () => ({ upsert: (row: Record<string, unknown>) => { cached.push(row); return Promise.resolve({ error: null }); } }) } } as unknown as Parameters<typeof lookupAcrossProviders>[0];
  // Recorded from Archive's ISBN search; the Carrier item has no creator field.
  let archiveBody: unknown = { response: { numFound: 1, docs: [{ date: '1973-01-01T00:00:00Z', identifier: 'isbn_9787710094420', language: 'English', publisher: 'Carrier Corporation', title: 'Carrier System Design Manual' }] } };
  let googleHit = false;
  globalThis.fetch = ((input) => {
    const url = new URL(input.toString());
    calls.push(url.hostname);
    if (url.hostname === 'openlibrary.org') return Promise.resolve(new Response('{}', { status: 404 }));
    if (url.hostname === 'www.googleapis.com') return Promise.resolve(googleHit ? Response.json({ items: [{ volumeInfo: { title: 'Earlier source' } }] }) : new Response('{}', { status: 429 }));
    if (url.hostname !== 'archive.org' || url.pathname !== '/advancedsearch.php' || url.searchParams.get('q') !== 'isbn:9787710094420 AND mediatype:texts' || url.searchParams.get('rows') !== '1' || !url.searchParams.getAll('fl[]').includes('publisher')) throw new Error(`unexpected Archive request: ${url}`);
    return Promise.resolve(Response.json(archiveBody));
  }) as typeof fetch;
  try {
    Deno.env.set('GOOGLE_BOOKS_API_KEY', 'test-key');
    const result = await (await lookupAcrossProviders(ctx, 'isbn', '9787710094420')).json();
    if (calls.join(',') !== 'openlibrary.org,www.googleapis.com,archive.org') throw new Error(`wrong fallback order: ${calls}`);
    if (result.status !== 'success' || result.data.title !== 'Carrier System Design Manual' || result.data.publisher !== 'Carrier Corporation' || result.data.publication_date !== '1973-01-01' || result.data.publication_date_precision !== 'year' || result.data.source_provider !== 'internet_archive' || result.data.source_url !== 'https://archive.org/details/isbn_9787710094420' || result.data.contributors.length !== 0) throw new Error(`incorrect Carrier metadata: ${JSON.stringify(result)}`);
    if (cached.length !== 1 || cached[0].provider !== 'internet_archive' || cached[0].identifier_value !== '9787710094420') throw new Error('Archive result was not cached');

    calls.length = 0;
    googleHit = true;
    await lookupAcrossProviders(ctx, 'isbn', '9787710094420');
    if (calls.includes('archive.org')) throw new Error('Archive was called despite an earlier success');

    Deno.env.delete('GOOGLE_BOOKS_API_KEY');
    if (providersFor('isbn').join(',') !== 'openlibrary,internet_archive') throw new Error('key-free Archive fallback missing');
    archiveBody = { response: { numFound: 0, docs: [] } };
    if ((await provider('internet_archive', '9787710094420')).kind !== 'not_found') throw new Error('empty search should be not_found');
    archiveBody = { response: { docs: [{ identifier: 'another-book', title: ['Book'], creator: ['First Author', 'Second Author'], publisher: ['Publisher'], description: '<p>Summary</p>' }] } };
    const book = await provider('internet_archive', '9787710094420');
    if (book.kind !== 'success' || book.data.contributors?.length !== 2 || book.data.publisher !== 'Publisher' || book.data.abstract !== 'Summary' || book.data.publication_date_precision !== undefined) throw new Error('array metadata or missing date parsed incorrectly');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) Deno.env.delete('GOOGLE_BOOKS_API_KEY');
    else Deno.env.set('GOOGLE_BOOKS_API_KEY', originalKey);
  }
});
