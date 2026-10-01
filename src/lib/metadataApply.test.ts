import { expect, it, vi } from 'vitest';
import { applyMetadata, defaultSelection, type ApplyInput } from './metadataApply';

const { rpc, filesRead } = vi.hoisted(() => ({ rpc: vi.fn().mockResolvedValue({ error: null }), filesRead: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, from: () => ({ select: () => ({ eq: filesRead }) }) } }));
vi.mock('@/lib/functions', () => ({ queueCover: vi.fn() }));

it('imports the journal into metadata without losing other fields or overriding manual locks', async () => {
  const input: ApplyInput = {
    data: { container_title: 'Energy Conversion and Management', source_provider: 'crossref', work_type: 'article' },
    fetchedAt: '2026-09-30', selected: ['container_title'], selectedCredits: [], includeCover: false,
    overrides: {}, workId: 'work', recordId: 'record', workLocks: [], recordLocks: [], candidates: [],
    suggest: () => { throw new Error('No contributors expected'); },
  };
  expect(defaultSelection(input.data, [], []).fields).toContain('container_title');
  expect(defaultSelection(input.data, [], ['container_title']).fields).not.toContain('container_title');
  await applyMetadata(input);
  expect(rpc).toHaveBeenLastCalledWith('apply_metadata_fields', expect.objectContaining({ p_metadata_patch: { container_title: input.data.container_title }, p_record_patch: expect.not.objectContaining({ container_title: expect.anything() }) }));
  rpc.mockClear();
  await applyMetadata({ ...input, recordLocks: ['container_title'] });
  expect(rpc).not.toHaveBeenCalled();
});


it('uses intact Unicode file metadata when a provider title has lost characters', async () => {
  const input: ApplyInput = {
    data: { title: 'Tu?rkiye u?zerine tezler', source_provider: 'google_books', work_type: 'book' },
    fetchedAt: '2026-09-30', selected: ['title'], selectedCredits: [], includeCover: false,
    overrides: {}, workId: 'work', recordId: 'record', workLocks: [], recordLocks: [], candidates: [],
    suggest: () => { throw new Error('No contributors expected'); },
  };
  filesRead.mockResolvedValue({ data: [{ assets: { metadata: { title_suggestion: 'Türkiye Üzerine Tezler' } } }], error: null });
  rpc.mockClear();
  await applyMetadata(input);
  expect(rpc.mock.calls[0][1].p_work_patch).toEqual({ title: 'Türkiye Üzerine Tezler' });
  filesRead.mockResolvedValue({ data: [], error: null });
  rpc.mockClear();
  await applyMetadata(input);
  expect(rpc).not.toHaveBeenCalled();
  filesRead.mockClear();
  await applyMetadata({ ...input, workLocks: ['title'] });
  expect(filesRead).not.toHaveBeenCalled();
  rpc.mockClear();
  await applyMetadata({ ...input, data: { ...input.data, title: '中国文学 — الأدب العربي' } });
  expect(rpc.mock.calls[0][1].p_work_patch).toEqual({ title: '中国文学 — الأدب العربي' });
});
