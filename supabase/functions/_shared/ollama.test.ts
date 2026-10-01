import { aiConfig, isAllowedModel, ollama } from './ollama.ts';
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
