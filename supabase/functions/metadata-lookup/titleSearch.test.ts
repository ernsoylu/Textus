import { searchTitleMetadata } from './index.ts';
Deno.test('title fallback sends only title/author and returns reviewable real provider candidates', async () => {
  const original = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = (input) => {
    const url = new URL(String(input)); calls.push(url);
    if (url.hostname === 'openlibrary.org') return Promise.resolve(Response.json({ docs: [{ key: '/works/OL123W', title: 'Solar Book', author_name: ['Jane Writer'], first_publish_year: 2025, isbn: ['9780261103252'] }] }));
    return Promise.resolve(Response.json({ message: { items: [{ title: ['Solar article'], DOI: '10.1000/solar', author: [{ given: 'Jane', family: 'Writer' }], type: 'journal-article' }] } }));
  };
  try {
    const candidates = await searchTitleMetadata('Solar', 'Jane');
    if (calls.length !== 2 || candidates.length !== 2 || candidates[0].identifier?.value !== '9780261103252' || candidates[1].identifier?.value !== '10.1000/solar') throw new Error('real identifiers/candidates lost');
    if (!calls.every((u) => u.protocol === 'https:' && !u.href.includes('front matter'))) throw new Error('unexpected disclosure/host');
  } finally { globalThis.fetch = original; }
});
