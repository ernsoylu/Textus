import { expect, it, vi } from 'vitest';
import { importMetadata } from './autoMetadataImport';
const { apply, from } = vi.hoisted(() => ({ apply: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from } }));
vi.mock('@/lib/metadataApply', async (original) => ({ ...await original<typeof import('./metadataApply')>(), applyMetadata: apply }));
it('never automatically applies cached LLM suggestions', async () => {
  const chain = { select: () => chain, eq: () => Promise.resolve({ error: null, data: [{ assets: { metadata: { filename: 'file.pdf' }, processing_state: 'ready' } }] }) };
  from.mockReturnValue(chain);
  const message = vi.fn();
  await importMetadata({ id: 'work', title: 'Existing title', metadata: {} }, { id: 'record', title: null, publisher: null, publication_date: null, metadata_fetched_at: null, metadata: { lookup_suggestions: { 'llm:local': { data: { title: 'Model title', source_provider: 'llm:local', work_type: 'book' } } } }, record_contributors: [], record_assets: [] }, message);
  expect(apply).not.toHaveBeenCalled();
  expect(message).toHaveBeenLastCalledWith(expect.stringContaining('No ISBN or DOI found'));
});
