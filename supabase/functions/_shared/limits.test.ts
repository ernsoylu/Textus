import { HttpError, jsonBody } from './limits.ts';
Deno.test('body byte limits apply with and without Content-Length', async () => {
  for (const headers of [new Headers({ 'Content-Length': '10' }), new Headers()]) {
    let rejected = false;
    try { await jsonBody(new Request('https://textus.invalid', { method: 'POST', headers, body: '{"a":1234}' }), 5); }
    catch (e) { rejected = e instanceof HttpError && e.status === 413; }
    if (!rejected) throw new Error('oversize body accepted');
  }
  if (await jsonBody(new Request('https://textus.invalid', { method: 'POST', body: 'broken' })) !== null) throw new Error('invalid JSON accepted');
});
