import { provider } from './index.ts';

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
