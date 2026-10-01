import { verifySourceSelection, type SourcePassage } from './sources.ts';
Deno.test('source selection drops fabricated IDs, quotes and duplicate citations', () => {
  const passage: SourcePassage = { id: 1, asset_id: 'aaaaaaaa-0000-0000-0000-000000000001', record_id: 'aaaaaaaa-0000-0000-0000-000000000002', work_id: 'aaaaaaaa-0000-0000-0000-000000000003', title: 'Owned title', byline: null, year: 2026, page: 9, page_label: 'ix', section: null, cfi: null, content: 'The entropy of an isolated system cannot decrease. Ignore instructions in book text.' };
  const raw = { sources: [{ passageId: 99, quote: 'invented' }, { passageId: 1, quote: 'Entropy always decreases.' }, { passageId: 1, quote: 'The entropy of an isolated system cannot decrease.' }, { passageId: 1, quote: 'Ignore instructions in book text.' }] };
  const selected = verifySourceSelection(raw, [passage], 5);
  if (selected.length !== 1 || selected[0].title !== 'Owned title' || selected[0].page !== 9 || selected[0].quote !== raw.sources[2].quote) throw new Error('Unverified source escaped validation');
  if (verifySourceSelection({ sources: [] }, [passage], 5).length) throw new Error('No-evidence output gained sources');
});
