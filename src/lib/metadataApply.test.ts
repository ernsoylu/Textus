import { expect, it, vi } from 'vitest';
import { applyMetadata, defaultSelection, type ApplyInput } from './metadataApply';

const { update, read, filesRead } = vi.hoisted(() => ({ update: vi.fn(), read: vi.fn(), filesRead: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => ({
  select: () => ({ eq: () => table === 'record_assets' ? filesRead() : ({ single: read }) }),
  update: (patch: unknown) => { update(patch); return { eq: async () => ({ error: null }) }; },
}) } }));
vi.mock('@/lib/functions', () => ({ queueCover: vi.fn() }));

it('imports the journal into metadata without losing other fields or overriding manual locks', async () => {
  const metadata = { version: 'published', locked_fields: ['contributors'], lookup_suggestions: { existing: true } };
  read.mockResolvedValue({ data: { metadata }, error: null });
  const input: ApplyInput = {
    data: { container_title: 'Energy Conversion and Management', source_provider: 'crossref', work_type: 'article' },
    fetchedAt: '2026-09-30', selected: ['container_title'], selectedCredits: [], includeCover: false,
    overrides: {}, workId: 'work', recordId: 'record', workLocks: [], recordLocks: [], candidates: [],
    suggest: () => { throw new Error('No contributors expected'); },
  };
  expect(defaultSelection(input.data, [], []).fields).toContain('container_title');
  expect(defaultSelection(input.data, [], ['container_title']).fields).not.toContain('container_title');
  await applyMetadata(input);
  expect(update.mock.lastCall![0].metadata).toEqual({ ...metadata, container_title: input.data.container_title });
  expect(update.mock.lastCall![0]).not.toHaveProperty('container_title');
  read.mockResolvedValue({ data: { metadata: { ...metadata, locked_fields: ['container_title'] } }, error: null });
  await applyMetadata(input);
  expect(update.mock.lastCall![0]).not.toHaveProperty('metadata');
});


it('uses intact Unicode file metadata when a provider title has lost characters', async () => {
  const input: ApplyInput = {
    data: { title: 'Tu?rkiye u?zerine tezler', source_provider: 'google_books', work_type: 'book' },
    fetchedAt: '2026-09-30', selected: ['title'], selectedCredits: [], includeCover: false,
    overrides: {}, workId: 'work', recordId: 'record', workLocks: [], recordLocks: [], candidates: [],
    suggest: () => { throw new Error('No contributors expected'); },
  };
  filesRead.mockResolvedValue({ data: [{ assets: { metadata: { title_suggestion: 'Türkiye Üzerine Tezler' } } }], error: null });
  update.mockClear();
  await applyMetadata(input);
  expect(update.mock.calls[0][0]).toEqual({ title: 'Türkiye Üzerine Tezler' });
  filesRead.mockResolvedValue({ data: [], error: null });
  update.mockClear();
  await applyMetadata(input);
  expect(update).not.toHaveBeenCalled();
  filesRead.mockClear();
  await applyMetadata({ ...input, workLocks: ['title'] });
  expect(filesRead).not.toHaveBeenCalled();
  update.mockClear();
  await applyMetadata({ ...input, data: { ...input.data, title: '中国文学 — الأدب العربي' } });
  expect(update.mock.calls[0][0]).toEqual({ title: '中国文学 — الأدب العربي' });
});
