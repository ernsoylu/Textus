import { standardProvider } from './standards.ts';

Deno.test('standards lookup matches exact official references and rejects other editions and domains', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = Deno.env.get('FIRECRAWL_API_KEY');
  const cases = [
    ['iso', 'ISO/PAS20065:2016(E)', 'ISO/PAS 20065:2016', 'https://www.iso.org/standard/66941.html'],
    ['iec', 'IEC 60335-1:2020', 'IEC 60335-1:2020', 'https://webstore.iec.ch/en/publication/61880'],
    ['astm', 'ASTM D638-14', 'ASTM D638-14', 'https://store.astm.org/d0638-14.html'],
    ['asme', 'ASME B31.3-2024', 'ASME B31.3-2024', 'https://www.asme.org/codes-standards/find-codes-standards/b313-2018-process-piping'],
    ['bs', 'BS EN ISO 9001:2015', 'BS EN ISO 9001:2015', 'https://knowledge.bsigroup.com/products/quality-management-systems-requirements'],
  ] as const;
  let reference: string = cases[0][2];
  let official: string = cases[0][3];
  let redirect = '';
  let status = 200;
  let scraped = 0;
  globalThis.fetch = ((input, init) => {
    const url = new URL(input.toString());
    if (url.origin !== 'https://api.firecrawl.dev') throw new Error('Unexpected API host');
    if (status !== 200) return Promise.resolve(new Response(null, { status, headers: { 'retry-after': '2' } }));
    if (url.pathname === '/v2/search') return Promise.resolve(Response.json({ success: true, data: { web: [{ url: 'https://evil.example/standard/66941.html' }, { url: official, title: reference }] } }));
    const body = JSON.parse(String(init?.body));
    if (body.url !== official) throw new Error('Scraped a non-official result');
    scraped++;
    return Promise.resolve(Response.json({ success: true, data: {
      markdown: official.includes('webstore.iec.ch') ? `### IEC 60335-1:2020+AMD1:2025 CSV\n\n# IEC 60335-1\n\n${reference}\n\nThe real standard\n\nReal abstract\n\nBASE PUBLICATION\n\n| **Publication date** | 2016-03 |\n| **Edition** | 6.0 |\n| **Pages** | 31 |` : `${reference}\nThe real standard`, metadata: { sourceURL: redirect || official },
      json: { reference: official.includes('bsigroup.com') ? reference + ' - TC' : reference, title: 'The real standard', abstract: 'Real abstract', publication_date: '2016-03', edition: '1', publisher: null, language: 'en', status: 'Withdrawn', pages: 31 },
    } }));
  }) as typeof fetch;
  try {
    Deno.env.set('FIRECRAWL_API_KEY', 'test-key');
    for (const [scheme, input, actual, url] of cases) {
      reference = actual; official = url;
      const result = await standardProvider(scheme, input);
      if (result.kind !== 'success' || result.data.work_type !== 'standard' || result.data.standard_reference !== actual || result.data.publication_date !== '2016-03-01' || result.data.publication_date_precision !== 'month' || result.data.source_url !== url || result.data.pages !== '31') throw new Error(`${scheme}: ${JSON.stringify(result)}`);
    }
    reference = 'ISO/PAS 20065:2017'; official = cases[0][3];
    if ((await standardProvider('iso', cases[0][1])).kind !== 'not_found') throw new Error('Imported the wrong edition');
    reference = cases[0][2]; redirect = 'https://evil.example/catalogue';
    if ((await standardProvider('iso', cases[0][1])).kind !== 'provider_error') throw new Error('Accepted an off-domain redirect');
    redirect = ''; official = 'http://www.iso.org/standard/66941.html'; scraped = 0;
    if ((await standardProvider('iso', cases[0][1])).kind !== 'not_found' || scraped !== 0) throw new Error('Scraped an unsafe URL');
    status = 429;
    const limited = await standardProvider('iso', cases[0][1]);
    if (limited.kind !== 'rate_limited' || limited.retryAfterMs !== 2000) throw new Error('Lost rate limit information');
    Deno.env.delete('FIRECRAWL_API_KEY');
    if ((await standardProvider('iso', cases[0][1])).kind !== 'provider_error') throw new Error('Missing configuration was not reported');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) Deno.env.delete('FIRECRAWL_API_KEY');
    else Deno.env.set('FIRECRAWL_API_KEY', originalKey);
  }
});
