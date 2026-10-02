import { aiConfig, embedPrompt, isAllowedModel, ollama } from './ollama.ts';
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
