import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'reader@example.test', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, aud: 'authenticated', role: 'authenticated', created_at: '2026-01-01T00:00:00Z' };
const token = `e30.${btoa(JSON.stringify({ sub: user.id, role: 'authenticated', exp: 4102444800 }))}.e30`;
const session = { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'test-refresh-token', user };
const workId = '10000000-0000-4000-8000-000000000001';
const recordId = '20000000-0000-4000-8000-000000000001';
const assetId = '30000000-0000-4000-8000-000000000001';

const work = {
  id: workId, title: 'The Garden Book', subtitle: null, abstract: null, language: 'en', work_type: 'book', user_rating: null, metadata: {},
  records: [{
    id: recordId, container_record_id: null, title: null, record_type: 'edition', publication_date: '2024-01-01',
    publication_date_precision: 'year', publisher: null, edition: null, volume: null, issue_number: null, pages: null,
    metadata: {}, metadata_source: null, metadata_fetched_at: null, identifiers: [], record_contributors: [], record_assets: [],
  }],
};

const libraryRow = {
  work_id: workId, title: 'The Garden Book', work_type: 'book', language: 'en', created_at: '2026-01-01T00:00:00Z',
  record_ids: [recordId], record_type: 'edition', publication_date: '2024-01-01', credits: [], tag_ids: [],
  collection_ids: [], formats: [], statuses: ['unread'], last_read_at: null, progress: null, cover_path: null, total: 1, user_rating: null,
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

test('filter by real work types and save specialized article metadata', async ({ page }) => {
  await mocks(page);
  await page.goto('/library');
  const types = page.getByRole('combobox', { name: 'Type', exact: true });
  await expect(types.locator('option')).toHaveText(['Type: any', 'Book', 'Article', 'Chapter', 'Serial', 'Thesis', 'Report', 'Standard', 'Other']);
  const request = page.waitForRequest((request) => request.url().includes('/rpc/library_page') && request.postDataJSON()?.p_work_type === 'standard');
  await types.selectOption('standard');
  await request;

  const record = { ...work.records[0], record_type: 'article_version', edition: 'First', metadata: { version: 'published', container_title: 'Old journal', locked_fields: ['contributors'] } };
  await page.route('**/rest/v1/works?*', (route) => route.fulfill({ json: { ...work, work_type: 'article', records: [record] } }));
  await page.route('**/rest/v1/records?*', (route) => {
    if (route.request().method() === 'PATCH') Object.assign(record, route.request().postDataJSON());
    return route.fulfill({ json: new URL(route.request().url()).searchParams.has('id') ? record : [] });
  });
  await page.goto(`/library/${workId}/edit`);
  await expect(page.getByRole('textbox', { name: 'Article title', exact: true })).toBeVisible();
  await expect(page.getByLabel('Journal', { exact: true })).toHaveValue('Old journal');
  await expect(page.getByPlaceholder('Edition', { exact: true })).toHaveCount(0);
  const schemes = page.getByRole('combobox', { name: 'Identifier scheme' });
  await expect(schemes).toHaveCount(1);
  await expect(schemes).toHaveValue('doi');
  const recordType = page.getByRole('combobox', { name: 'Record type', exact: true });
  for (const [type, label] of [['thesis', 'University'], ['report', 'Issuing institution'], ['standard', 'Standards body'], ['edition', 'Publisher']]) {
    await recordType.selectOption(type);
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  await recordType.selectOption('article_version');
  await page.getByLabel('Journal', { exact: true }).fill('New journal');
  const saved = page.waitForRequest((request) => request.url().includes('/rest/v1/records?') && request.method() === 'PATCH');
  await page.getByRole('button', { name: 'Save', exact: true }).nth(1).click();
  const payload = (await saved).postDataJSON();
  expect(payload.record_type).toBe('article_version');
  expect(payload).not.toHaveProperty('edition');
  expect(payload.metadata).toMatchObject({ container_title: 'New journal', version: 'published', locked_fields: expect.arrayContaining(['contributors', 'container_title']) });
});

test('look up an ISO reference and apply its metadata and identifier', async ({ page }) => {
  await mocks(page);
  const record = { ...work.records[0], identifiers: [] as { scheme: string; normalized_value: string }[], metadata: { locked_fields: ['contributors'], version: 'existing' } };
  const standard = { ...work, records: [record] };
  await page.route('**/rest/v1/works?*', (route) => {
    if (route.request().method() === 'PATCH') Object.assign(standard, route.request().postDataJSON());
    return route.fulfill({ json: standard });
  });
  await page.route('**/rest/v1/records?*', (route) => {
    if (route.request().method() === 'PATCH') Object.assign(record, route.request().postDataJSON());
    return route.fulfill({ json: new URL(route.request().url()).searchParams.has('id') ? record : [] });
  });
  await page.route('**/rest/v1/identifiers?*', (route) => {
    const value = route.request().postDataJSON();
    record.identifiers.push({ scheme: value.scheme, normalized_value: value.normalized_value });
    return route.fulfill({ json: [] });
  });
  await page.route('**/functions/v1/metadata-lookup', (route) => route.fulfill({ json: {
    status: 'success', fromCache: false, fetchedAt: '2026-09-30', data: {
      title: 'Acoustics — Objective method for assessing tones in noise', work_type: 'standard',
      source_provider: 'iso', source_url: 'https://www.iso.org/standard/66941.html',
      standard_scheme: 'iso', standard_reference: 'ISO/PAS 20065:2016', standard_status: 'Withdrawn',
      publisher: 'ISO', edition: '1', publication_date: '2016-03-01', publication_date_precision: 'month',
    },
  } }));
  await page.goto(`/library/${workId}/edit`);
  const lookup = page.getByRole('region', { name: 'Metadata lookup' });
  await expect(lookup.getByLabel('Identifier scheme').locator('option')).toContainText(['ISO', 'IEC', 'ASTM', 'ASME', 'BS']);
  await lookup.getByLabel('Identifier scheme').selectOption('iso');
  await lookup.getByLabel('Lookup reference').fill('ISO/PAS20065:2016(E)');
  await lookup.getByRole('button', { name: 'Look up', exact: true }).click();
  await expect(lookup.getByText('standard reference:', { exact: false })).toBeVisible();
  await expect(lookup.getByRole('link', { name: 'Open source catalogue' })).toHaveAttribute('href', 'https://www.iso.org/standard/66941.html');
  await lookup.getByRole('button', { name: 'Apply selected metadata' }).click();
  await expect(page.getByLabel('Work type', { exact: true })).toHaveValue('standard');
  await expect(page.getByLabel('Record type')).toHaveValue('standard');
  await expect(page.getByLabel('Revision')).toHaveValue('1');
  expect(record.identifiers).toEqual([{ scheme: 'iso', normalized_value: 'ISO/PAS20065:2016' }]);
  expect(record.metadata).toMatchObject({ version: 'existing', standard_status: 'Withdrawn', source_url: 'https://www.iso.org/standard/66941.html', locked_fields: ['contributors'] });
});

test('save, display, and clear a personal book rating', async ({ page }) => {
  await mocks(page);
  const book = { ...work };
  await page.route('**/rest/v1/works?*', (route) => {
    if (route.request().method() === 'PATCH') Object.assign(book, route.request().postDataJSON());
    return route.fulfill({ json: book });
  });
  await page.route('**/rest/v1/rpc/library_page', (route) => route.fulfill({ json: [{ ...libraryRow, user_rating: book.user_rating }] }));
  await page.goto(`/library/${workId}/edit`);
  const rating = page.getByRole('combobox', { name: 'Your rating' });
  await expect(rating).toHaveValue('');
  await rating.selectOption('4');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect.poll(() => book.user_rating).toBe(4);
  await page.goto('/library');
  await expect(page.getByLabel('Your rating: 4 out of 5 stars')).toBeVisible();
  await page.goto(`/library/${workId}/edit`);
  await expect(rating).toHaveValue('4');
  await rating.selectOption('');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect.poll(() => book.user_rating).toBeNull();
  await page.goto('/library');
  await expect(page.getByLabel('Your rating: 4 out of 5 stars')).toHaveCount(0);
});

test('long fallback cover titles stay inside the thumbnail in both densities', async ({ page }) => {
  await mocks(page);
  const title = 'A very long book title '.repeat(30);
  await page.route('**/rest/v1/rpc/library_page', (route) => route.fulfill({ json: [{ ...libraryRow, title }] }));
  await page.goto('/library');
  const card = page.getByRole('link', { name: `Open ${title}`, exact: true });
  await expect(card).toBeVisible();
  for (const density of ['comfortable', 'compact']) {
    await page.evaluate((value) => { document.documentElement.dataset.density = value; }, density);
    const bounds = await card.evaluate((element) => {
      const cover = element.firstElementChild!;
      const title = cover.children[1] as HTMLElement;
      const byline = cover.children[2];
      return {
        clipped: title.scrollHeight > title.clientHeight,
        titleBottom: title.getBoundingClientRect().bottom,
        bylineTop: byline.getBoundingClientRect().top,
        bylineBottom: byline.getBoundingClientRect().bottom,
        coverBottom: cover.getBoundingClientRect().bottom,
        fullTitle: element.closest('article')!.children[1].textContent,
      };
    });
    expect(bounds.clipped).toBe(true);
    expect(bounds.titleBottom).toBeLessThanOrEqual(bounds.bylineTop);
    expect(bounds.bylineBottom).toBeLessThanOrEqual(bounds.coverBottom);
    expect(bounds.fullTitle).toBe(title);
  }
});

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
  await page.goto(`/library/${workId}/edit`);
  await expect(page.getByRole('textbox', { name: 'Book title', exact: true })).toHaveValue('The Garden Book');

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


test('library opens book details, metadata shares one input, and Read opens the full reader', async ({ page }) => {
  await mocks(page);
  const book = { ...work, subtitle: 'A practical guide', abstract: 'Grow a beautiful garden.', records: [{ ...work.records[0], publisher: 'Garden Press', pages: '120', identifiers: [{ scheme: 'isbn', normalized_value: '9780261103252' }], record_assets: [{ role: 'primary', assets: { id: assetId, bucket: 'documents', storage_path: 'fixture.pdf', file_format: 'pdf', processing_state: 'ready', file_size: 1024 } }] }] };
  await page.route('**/rest/v1/works?*', (route) => route.fulfill({ json: book }));
  await page.goto('/library');
  await page.getByRole('link', { name: 'The Garden Book', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The Garden Book', exact: true })).toBeVisible();
  await expect(page.getByText('Grow a beautiful garden.')).toBeVisible();
  await expect(page.getByText('Garden Press')).toBeVisible();
  await expect(page.getByLabel('Book title', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Gather metadata' }).click();
  const lookup = page.getByRole('region', { name: 'Metadata lookup' });
  await expect(lookup.getByRole('textbox')).toHaveCount(1);
  await expect(lookup.getByLabel('Lookup reference')).toHaveValue('9780261103252');
  await expect(lookup.getByRole('button', { name: 'Save identifier' })).toBeVisible();
  await expect(lookup.getByRole('button', { name: 'Look up', exact: true })).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('link', { name: 'Read book', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.screenshot({ path: '/tmp/textus-book-page.png', fullPage: true });
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(scan.violations, JSON.stringify(scan.violations, null, 2)).toEqual([]);
  await page.getByRole('link', { name: 'Edit book', exact: true }).click();
  await expect(page).toHaveURL(`/library/${workId}/edit`);
  await expect(page.getByLabel('Work type', { exact: true })).toBeVisible();
  const order = await page.locator('main').evaluate((main) => {
    const type = main.querySelector('[aria-label="Work type"]')!;
    const title = main.querySelector('input[placeholder="Title"]')!;
    const authors = Array.from(main.querySelectorAll('h2')).find((heading) => heading.textContent?.startsWith('Authors & contributors'))!;
    const description = main.querySelector('textarea')!;
    return [type, title, authors].every((node, index) => !!(node.compareDocumentPosition([title, authors, description][index]) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(order).toBe(true);
  await page.getByRole('link', { name: 'Back to book' }).click();
  await page.getByRole('link', { name: 'Read book', exact: true }).click();
  await expect(page).toHaveURL(`/library/${workId}/records/${recordId}/assets/${assetId}/read`);
  await expect(page.getByLabel('Reading status')).toBeVisible();
  await expect(page.getByText('Textus reader fixture')).toBeVisible();
  await expect(page.getByText('Add note to page 1')).toBeVisible();
});


test('global and library searches show cover ribbons and support keyboard navigation', async ({ page }) => {
  await mocks(page);
  await page.route('**/rest/v1/rpc/library_page', (route) => route.fulfill({ json: [{ ...libraryRow, credits: [{ role: 'author', position: 0, credited_as: null, display_name: 'Jane Gardener' }], cover_path: 'garden-cover.png', formats: ['pdf'] }] }));
  await page.route('**/storage/v1/object/sign/covers', (route) => route.fulfill({ json: [{ path: 'garden-cover.png', signedURL: '/garden-cover.svg' }] }));
  await page.route('**/garden-cover.svg*', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="80"><rect width="56" height="80" fill="green"/></svg>' }));
  await page.goto('/library');
  const top = page.getByRole('searchbox', { name: 'Search titles, people, identifiers' });
  await top.fill('Jane Gardener');
  let results = page.getByRole('list', { name: 'Book search results' });
  await expect(results.getByText('Jane Gardener')).toBeVisible();
  await expect(results.locator('img')).toBeVisible();
  await expect(results.getByText('edition · 2024 · PDF')).toBeVisible();
  await top.press('ArrowDown');
  await expect(results.getByRole('link')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/library/${workId}`);
  await expect(results).toHaveCount(0);
  await page.goto('/library');
  await page.getByLabel('Search library', { exact: true }).fill('garden');
  results = page.getByRole('list', { name: 'Book search results' });
  await expect(results.getByText('Jane Gardener')).toBeVisible();
  await results.getByRole('link').click();
  await expect(page.getByRole('heading', { name: 'The Garden Book', exact: true })).toBeVisible();
});

test('book details allow toggling tags and collection membership', async ({ page }) => {
  await mocks(page);
  const tagId = '40000000-0000-4000-8000-000000000001';
  const collectionId = '50000000-0000-4000-8000-000000000001';
  let tagged = false;
  let collected = false;
  await page.route('**/rest/v1/tags?*', (route) => route.fulfill({ json: [{ id: tagId, name: 'Gardening', color: null }] }));
  await page.route('**/rest/v1/collections?*', (route) => route.fulfill({ json: [{ id: collectionId, name: 'Favourites', description: null, collection_records: [{ count: 0 }] }] }));
  await page.route('**/rest/v1/record_tags*', (route) => {
    if (route.request().method() === 'POST') tagged = true;
    if (route.request().method() === 'DELETE') tagged = false;
    return route.fulfill({ json: tagged ? [{ tag_id: tagId }] : [] });
  });
  await page.route('**/rest/v1/collection_records*', (route) => {
    if (route.request().method() === 'POST') collected = true;
    if (route.request().method() === 'DELETE') collected = false;
    return route.fulfill({ json: collected ? [{ collection_id: collectionId, display_order: 0 }] : [] });
  });
  await page.goto(`/library/${workId}`);
  const tag = page.getByRole('button', { name: 'Gardening', exact: true });
  await tag.click();
  await expect(tag).toHaveAttribute('aria-pressed', 'true');
  await tag.click();
  await expect(tag).toHaveAttribute('aria-pressed', 'false');
  const collection = page.getByRole('checkbox', { name: 'Favourites' });
  await collection.click();
  await expect(collection).toBeChecked();
  await collection.click();
  await expect(collection).not.toBeChecked();
});


test('one identifier input saves a DOI and rejects invalid ISBNs before writing', async ({ page }) => {
  await mocks(page);
  await page.goto(`/library/${workId}/edit`);
  const lookup = page.getByRole('region', { name: 'Metadata lookup' });
  const reference = lookup.getByLabel('Lookup reference');
  await reference.fill('123');
  await lookup.getByRole('button', { name: 'Save identifier' }).click();
  await expect(lookup.getByRole('alert')).toContainText('valid ISBN');
  await lookup.getByLabel('Identifier scheme').selectOption('doi');
  await reference.fill('https://doi.org/10.1000/182');
  const saved = page.waitForRequest((request) => request.url().includes('/rest/v1/identifiers') && request.method() === 'POST');
  await lookup.getByRole('button', { name: 'Save identifier' }).click();
  expect((await saved).postDataJSON()).toMatchObject({ record_id: recordId, scheme: 'doi', normalized_value: '10.1000/182' });
  await expect(lookup.getByText('Identifier saved.', { exact: true })).toBeVisible();
});


test('cover hover opens the reader directly and saves half-star ratings', async ({ page }) => {
  await mocks(page);
  const book = { ...work };
  await page.route('**/rest/v1/works?*', (route) => {
    if (route.request().method() === 'PATCH') Object.assign(book, route.request().postDataJSON());
    return route.fulfill({ json: book });
  });
  await page.route('**/rest/v1/rpc/library_page', (route) => route.fulfill({ json: [{ ...libraryRow, user_rating: book.user_rating, formats: ['pdf'], read_record_id: recordId, read_asset_id: assetId }] }));
  await page.goto('/library');
  const card = page.locator('article').filter({ has: page.getByRole('link', { name: 'The Garden Book', exact: true }) });
  await card.locator('.group').hover();
  await expect(card.locator('.absolute.inset-0').first()).toHaveCSS('opacity', '1');
  await expect(card.getByRole('link', { name: 'Open The Garden Book', exact: true })).toHaveCSS('filter', 'blur(4px)');
  await expect(card.getByRole('link', { name: 'Read book', exact: true })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Open book page' })).toBeVisible();
  const rating = card.getByRole('slider', { name: 'Rate The Garden Book' });
  await rating.focus();
  await rating.press('End');
  await expect.poll(() => book.user_rating).toBe(5);
  await rating.press('ArrowLeft');
  await expect.poll(() => book.user_rating).toBe(4.5);
  await expect(card.getByText('4.5 / 5 ★')).toBeVisible();
  await rating.press('Home');
  await expect.poll(() => book.user_rating).toBe(0.5);
  for (const density of ['comfortable', 'compact']) {
    await page.evaluate((value) => { document.documentElement.dataset.density = value; }, density);
    await card.locator('.group').hover();
    const fits = await card.locator('.group').evaluate((cover) => {
      const bounds = cover.getBoundingClientRect();
      return Array.from(cover.querySelectorAll('a, input')).every((element) => { const rect = element.getBoundingClientRect(); return rect.top >= bounds.top && rect.bottom <= bounds.bottom; });
    });
    expect(fits).toBe(true);
  }
  const hoverScan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(hoverScan.violations, JSON.stringify(hoverScan.violations, null, 2)).toEqual([]);
  await page.screenshot({ path: '/tmp/textus-cover-controls.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await card.getByRole('link', { name: 'Read book', exact: true }).click();
  await expect(page).toHaveURL(`/library/${workId}/records/${recordId}/assets/${assetId}/read`);
  await expect(page.getByText('Textus reader fixture')).toBeVisible();
  await page.goto('/library');
  await page.getByRole('link', { name: 'The Garden Book', exact: true }).click();
  await expect(page).toHaveURL(`/library/${workId}`);
});
