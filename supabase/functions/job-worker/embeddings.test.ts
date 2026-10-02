import { nextBatch } from './embeddings.ts';
Deno.test('Ollama batches take up to 16 passages within 32 KB, and always at least one', () => {
  const short = Array.from({ length: 40 }, (_, i) => ({ content: `passage ${i} `.repeat(150) }));
  if (nextBatch(short, 0).length !== 16 || nextBatch(short, 32).length !== 8) throw new Error('count limit');
  const long = Array.from({ length: 6 }, () => ({ content: 'ğ'.repeat(3_900) })); // 7.8 KB each in UTF-8
  if (nextBatch(long, 0).length !== 4) throw new Error('byte limit');
  if (nextBatch([{ content: 'x'.repeat(40_000) }], 0).length !== 1) throw new Error('an oversized passage still goes alone');
});
