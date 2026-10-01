import { AddFileFromUrl, TagWork, catalogPreview } from './agentWrites.ts';
Deno.test('write boundaries reject self-confirmation/private URLs and preserve provisional identities', () => {
  const ids = { requestId: 'aaaaaaaa-0000-0000-0000-000000000001', workId: 'aaaaaaaa-0000-0000-0000-000000000002', tagId: 'aaaaaaaa-0000-0000-0000-000000000003' };
  if (TagWork.safeParse({ ...ids, confirmed: true }).success) throw new Error('Agent confirmation accepted');
  if (AddFileFromUrl.safeParse({ requestId: ids.requestId, recordId: ids.workId, url: 'http://127.0.0.1/private' }).success) throw new Error('Private download accepted');
  const preview = catalogPreview({ title: 'Real provider title', work_type: 'book', source_provider: 'fixture', contributors: [{ name: 'Ada Lovelace', role: 'author', identifiers: { orcid: 'invalid', wikidata: 'Q7259' } }] }, 'isbn', '9780140328721');
  if (preview.credits.length !== 1 || 'contributor_id' in preview.credits[0] || preview.credits[0].identifiers.orcid || preview.credits[0].identifiers.wikidata !== 'Q7259') throw new Error('Name-only merge or unvalidated authority ID');
});
