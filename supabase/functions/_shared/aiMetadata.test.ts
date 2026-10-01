import { validateAiMetadata } from './aiMetadata.ts';
import { truncateUtf8 } from './text.ts';
Deno.test('AI metadata requires real front-matter evidence and cannot supply URLs or identifiers', () => {
  const raw = { title: 'Solar book', authors: ['Jane Writer'], year: 2025, publisher: null, language: null, work_type: 'book', evidence: 'Solar book' };
  const result = validateAiMetadata(raw, 'Solar book by Jane Writer', { name: 'local:4b', digest: 'immutable' });
  if (result.source_provider !== 'llm:local:4b' || result.model_digest !== 'immutable') throw new Error('provenance missing');
  for (const invalid of [{ ...raw, evidence: 'invented' }, { ...raw, cover_url: 'http://localhost/' }, { ...raw, doi: '10.1/fake' }]) {
    let rejected = false; try { validateAiMetadata(invalid, 'Solar book', { name: 'local', digest: 'v' }); } catch { rejected = true; }
    if (!rejected) throw new Error('unverifiable/extra model output accepted');
  }
  if (truncateUtf8('😀 güneş', 5) !== '😀 ') throw new Error('UTF-8 budget cuts a character');
});
