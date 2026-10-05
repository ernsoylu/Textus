import { aiConfig, embedPrompt, embedText, isAllowedModel, ollama } from './ollama.ts';
Deno.test('disabled AI makes no outbound request; installed cloud/unapproved models are rejected', async () => {
  const previous = Deno.env.get('AI_ENABLED');
  Deno.env.set('AI_ENABLED', 'false');
  try {
    if (aiConfig().enabled) throw new Error('disabled AI was enabled');
    try { await ollama('/api/version'); throw new Error('request did not fail'); }
    catch (e) { if (!(e instanceof Error) || e.message !== 'ai_disabled') throw e; }
    const base = { name: 'local:4b', digest: 'digest', size: 1 };
    if (!isAllowedModel(base, [base.name])) throw new Error('approved local model rejected');
    for (const model of [{ ...base, remote_host: 'https://cloud.invalid' }, { ...base, name: 'local:cloud' }, { ...base, capabilities: ['embedding'] }]) {
      if (isAllowedModel(model, [model.name])) throw new Error('cloud/embedding model accepted');
    }
    if (isAllowedModel(base, [])) throw new Error('unapproved model accepted');
  } finally { if (previous === undefined) Deno.env.delete('AI_ENABLED'); else Deno.env.set('AI_ENABLED', previous); }
});

Deno.test('embedding prompts follow each model\'s trained format', () => {
  if (embedPrompt('embeddinggemma:latest', 'Carnot cycle', true) !== 'task: search result | query: Carnot cycle') throw new Error('gemma query');
  if (embedPrompt('embeddinggemma', 'Page text', false) !== 'title: none | text: Page text') throw new Error('gemma document');
  if (embedPrompt('nomic-embed-text:latest', 'Page text', false) !== 'search_document: Page text') throw new Error('nomic document');
  if (embedPrompt('other-embedder:1b', 'Page text', true) !== 'Page text') throw new Error('unknown models get raw text');
});

Deno.test('an over-long passage is retried truncated; other 400s are not retried', async () => {
  const env = { AI_ENABLED: 'true', OLLAMA_URL: 'http://ollama.invalid' };
  const previous = Object.fromEntries(Object.keys(env).map((k) => [k, Deno.env.get(k)]));
  const realFetch = globalThis.fetch;
  const model = { name: 'embeddinggemma:latest', digest: 'a'.repeat(64), size: 1 };
  const truncates: boolean[] = [];
  let embedError = 'the input length exceeds the context length';
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/api/tags')) return Promise.resolve(Response.json({ models: [model] }));
    const body = JSON.parse(String(init?.body));
    truncates.push(body.truncate);
    return Promise.resolve(body.truncate ? Response.json({ embeddings: [Array(768).fill(0.1)] }) : Response.json({ error: embedError }, { status: 400 }));
  };
  try {
    for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
    if ((await embedText(model, ['C3H5N3O9']))[0].length !== 768 || truncates.join() !== 'false,true') throw new Error('over-long passage not retried truncated');
    truncates.length = 0; embedError = 'invalid input';
    try { await embedText(model, ['x']); throw new Error('bad request accepted'); }
    catch (e) { if (!(e instanceof Error) || e.message !== 'invalid_request' || truncates.join() !== 'false') throw e; }
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(previous)) if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v);
  }
});
