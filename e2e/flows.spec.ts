import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'reader@example.test', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z' };
const token = `e30.${btoa(JSON.stringify({ sub: user.id, role: 'authenticated', exp: 4102444800 }))}.e30`;
const session = { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'test-refresh-token', user };
const workId = '10000000-0000-4000-8000-000000000001';
const recordId = '20000000-0000-4000-8000-000000000001';
const assetId = '30000000-0000-4000-8000-000000000001';

const work = {
  id: workId, title: 'The Garden Book', subtitle: null, abstract: null, language: 'en', work_type: 'book', metadata: {},
  records: [{
    id: recordId, container_record_id: null, title: null, record_type: 'edition', publication_date: '2024-01-01',
    publication_date_precision: 'year', publisher: null, edition: null, volume: null, issue_number: null, pages: null,
    metadata: {}, metadata_source: null, metadata_fetched_at: null, identifiers: [], record_contributors: [], record_assets: [],
  }],
};

const libraryRow = {
  work_id: workId, title: 'The Garden Book', work_type: 'book', language: 'en', created_at: '2026-01-01T00:00:00Z',
  record_ids: [recordId], record_type: 'edition', publication_date: '2024-01-01', credits: [], tag_ids: [],
  collection_ids: [], formats: [], statuses: ['unread'], last_read_at: null, progress: null, cover_path: null, total: 1,
};

function pdfFixture() {
  const content = 'BT /F1 18 Tf 40 720 Td (Textus reader fixture) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
}

async function mocks(page: Page, signedIn = true) {
  if (signedIn) await page.addInitScript(({ key, stored }) => localStorage.setItem(key, JSON.stringify(stored)), { key: 'sb-127-auth-token', stored: session });
  await page.route('**/auth/v1/user', (route) => route.fulfill({ json: user }));
  await page.route('**/auth/v1/token?grant_type=password', (route) => route.fulfill({ json: session }));
  await page.route('**/functions/v1/upload/intent', (route) => route.fulfill({ json: { path: `${user.id}/${crypto.randomUUID()}/upload`, token: 'upload-token' } }));
  await page.route('**/functions/v1/upload/complete', (route) => route.fulfill({ json: { status: 'created', asset: { id: assetId } } }));
  await page.route('**/functions/v1/metadata-lookup', (route) => route.fulfill({ json: {
    status: 'success', fromCache: false, fetchedAt: '2026-01-01T00:00:00Z',
    data: { title: 'Garden Research', source_provider: 'openlibrary', work_type: 'book', contributors: [] },
  } }));
  await page.route('**/storage/v1/object/upload/sign/staging/**', (route) => route.fulfill({ status: 200, json: { Key: 'staged' } }));
  await page.route('**/rest/v1/**', (route) => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    if (name === 'library_page') {
      const args = route.request().postDataJSON() as { p_q?: string };
      return route.fulfill({ json: args.p_q ? [] : [libraryRow] });
    }
    return route.fulfill({ json: [] });
  });
  await page.route('**/rest/v1/works?*', (route) => route.fulfill({ json: work }));
  await page.route('**/rest/v1/assets?*', (route) => route.fulfill({ json: { id: assetId, bucket: 'documents', storage_path: 'fixture.pdf', file_format: 'pdf' } }));
  await page.route('**/storage/v1/object/sign/**', (route) => route.fulfill({ json: { signedURL: '/reader-fixture.pdf?token=e2e' } }));
  await page.route('**/reader-fixture.pdf**', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: pdfFixture() }));
}

test('sign in, search the library, and pass the library accessibility scan', async ({ page }) => {
  await mocks(page, false);
  await page.goto('/login');
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password').fill('local-test-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByText('The Garden Book').first()).toBeVisible();

  await page.getByPlaceholder('Search title, contributor or file text…').fill('no such title');
  await expect(page.getByText('Nothing matches these filters.')).toBeVisible();
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual([]);
});

test('upload a file, preview metadata, and open the reader', async ({ page }) => {
  await mocks(page);
  await page.goto(`/library/${workId}`);
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('The Garden Book');

  const file = page.locator('input[type="file"]');
  await file.setInputFiles({ name: 'garden.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
  await expect(page.getByText('Uploaded')).toBeVisible();

  const lookup = page.getByRole('region', { name: 'Metadata lookup' });
  await lookup.getByPlaceholder('Identifier').fill('9780261103252');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByText(/From openlibrary/)).toBeVisible();
  await expect(page.getByText(/Garden Research/)).toBeVisible();
  const detailScan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(detailScan.violations, JSON.stringify(detailScan.violations, null, 2)).toEqual([]);

  await page.goto(`/library/${workId}/records/${recordId}/assets/${assetId}/read`);
  await expect(page.getByLabel('Reading status')).toBeVisible();
  await expect(page.getByText('of 1')).toBeVisible();
  await expect(page.getByText('Textus reader fixture')).toBeVisible();
  const readerScan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(readerScan.violations, JSON.stringify(readerScan.violations, null, 2)).toEqual([]);
});
