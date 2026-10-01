-- library_page() / search_library() / asset_texts: filters, sorts, pagination, file-text search (FR-ORG-3,
-- FR-SRCH-1, NFR-PERF-1) and isolation between users. Runs in a transaction and rolls back.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(43);

INSERT INTO auth.users (id, email) VALUES
    ('aaaaaaaa-1111-0000-0000-000000000000', 'la@test.local'),
    ('bbbbbbbb-1111-0000-0000-000000000000', 'lb@test.local');

-- ---------- User A: three works ----------
INSERT INTO works (id, user_id, work_type, title, language, created_at) VALUES
    ('a1000000-1111-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000000', 'book',    'Alpha Garden',  'en', '2026-01-01'),
    ('a1000000-1111-0000-0000-000000000002', 'aaaaaaaa-1111-0000-0000-000000000000', 'article', 'Beta Machine',  'de', '2026-01-02'),
    ('a1000000-1111-0000-0000-000000000003', 'aaaaaaaa-1111-0000-0000-000000000000', 'book',    'Gamma Garden',  'en', '2026-01-03');
INSERT INTO records (id, work_id, record_type, publication_date, created_at) VALUES
    ('a2000000-1111-0000-0000-000000000001', 'a1000000-1111-0000-0000-000000000001', 'edition', '2000-01-01', '2026-01-01'),
    ('a2000000-1111-0000-0000-000000000002', 'a1000000-1111-0000-0000-000000000002', 'article_version', '1990-01-01', '2026-01-02'),
    ('a2000000-1111-0000-0000-000000000003', 'a1000000-1111-0000-0000-000000000003', 'edition', '2010-01-01', '2026-01-03');
INSERT INTO contributors (id, user_id, display_name, family_name, given_names, sort_name, match_key) VALUES
    ('a3000000-1111-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000000', 'Zed Author', 'Author', 'Zed', 'Author, Zed', 'author'),
    ('a3000000-1111-0000-0000-000000000002', 'aaaaaaaa-1111-0000-0000-000000000000', 'Amy Author', 'Author', 'Amy', 'Author, Amy', 'author');
INSERT INTO record_contributors (record_id, contributor_id, role, position) VALUES
    ('a2000000-1111-0000-0000-000000000001', 'a3000000-1111-0000-0000-000000000001', 'author', 0),
    ('a2000000-1111-0000-0000-000000000003', 'a3000000-1111-0000-0000-000000000002', 'author', 0);
INSERT INTO tags (id, user_id, name) VALUES ('a4000000-1111-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000000', 'fiction');
INSERT INTO record_tags (record_id, tag_id) VALUES ('a2000000-1111-0000-0000-000000000001', 'a4000000-1111-0000-0000-000000000001');
INSERT INTO collections (id, user_id, name) VALUES ('a5000000-1111-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000000', 'Shelf');
INSERT INTO collection_records (collection_id, record_id) VALUES ('a5000000-1111-0000-0000-000000000001', 'a2000000-1111-0000-0000-000000000003');
INSERT INTO assets (id, user_id, bucket, storage_path, file_size, checksum_sha256, mime_type, file_format) VALUES
    ('a6000000-1111-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000000', 'documents', 'aaaaaaaa-1111-0000-0000-000000000000/one.pdf', 10, 'lp-one', 'application/pdf', 'pdf');
INSERT INTO record_assets (record_id, asset_id) VALUES ('a2000000-1111-0000-0000-000000000001', 'a6000000-1111-0000-0000-000000000001');
INSERT INTO asset_texts (asset_id, user_id, content) VALUES ('a6000000-1111-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000000', 'a study of quantum entanglement in gardens');
INSERT INTO reading_states (user_id, record_id, status, progress_percentage, last_read_at) VALUES
    ('aaaaaaaa-1111-0000-0000-000000000000', 'a2000000-1111-0000-0000-000000000003', 'reading', 40, '2026-02-01');

-- ---------- User B: one work that also mentions gardens and quantum ----------
INSERT INTO works (id, user_id, work_type, title, language) VALUES
    ('b1000000-1111-0000-0000-000000000001', 'bbbbbbbb-1111-0000-0000-000000000000', 'book', 'Garden of B', 'en');
INSERT INTO records (id, work_id, record_type) VALUES ('b2000000-1111-0000-0000-000000000001', 'b1000000-1111-0000-0000-000000000001', 'edition');
INSERT INTO assets (id, user_id, bucket, storage_path, file_size, checksum_sha256, mime_type, file_format) VALUES
    ('b6000000-1111-0000-0000-000000000001', 'bbbbbbbb-1111-0000-0000-000000000000', 'documents', 'bbbbbbbb-1111-0000-0000-000000000000/b.pdf', 10, 'lp-b', 'application/pdf', 'pdf');
INSERT INTO record_assets (record_id, asset_id) VALUES ('b2000000-1111-0000-0000-000000000001', 'b6000000-1111-0000-0000-000000000001');
INSERT INTO asset_texts (asset_id, user_id, content) VALUES ('b6000000-1111-0000-0000-000000000001', 'bbbbbbbb-1111-0000-0000-000000000000', 'quantum garden secrets');

-- ---------- As user A ----------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "aaaaaaaa-1111-0000-0000-000000000000", "role": "authenticated"}';

SELECT is(ARRAY(SELECT title FROM library_page()), ARRAY['Gamma Garden', 'Beta Machine', 'Alpha Garden'], 'default sort is newest first');
SELECT is((SELECT user_rating FROM library_page() WHERE title = 'Alpha Garden'), NULL::numeric, 'books start unrated');
UPDATE works SET user_rating = 4 WHERE id = 'a1000000-1111-0000-0000-000000000001';
SELECT is((SELECT user_rating FROM library_page() WHERE title = 'Alpha Garden'), 4::numeric, 'owner rating appears in the library');
SELECT throws_ok($$UPDATE works SET user_rating = 6 WHERE id = 'a1000000-1111-0000-0000-000000000001'$$, '23514', NULL, 'ratings above five are rejected');
UPDATE works SET user_rating = 3.5 WHERE id = 'a1000000-1111-0000-0000-000000000001';
SELECT is((SELECT user_rating FROM library_page() WHERE title = 'Alpha Garden'), 3.5::numeric, 'half-star ratings persist');
SELECT throws_ok($$UPDATE works SET user_rating = 3.2 WHERE id = 'a1000000-1111-0000-0000-000000000001'$$, '23514', NULL, 'non-half-star ratings are rejected');
SELECT throws_ok($$UPDATE works SET user_rating = 0 WHERE id = 'a1000000-1111-0000-0000-000000000001'$$, '23514', NULL, 'zero ratings are rejected; null clears a rating');
SELECT is((SELECT read_record_id FROM library_page() WHERE title = 'Alpha Garden'), 'a2000000-1111-0000-0000-000000000001'::uuid, 'read action targets the linked record');
SELECT is((SELECT read_asset_id FROM library_page() WHERE title = 'Alpha Garden'), 'a6000000-1111-0000-0000-000000000001'::uuid, 'read action targets the linked PDF');
SELECT is((SELECT read_asset_id FROM library_page() WHERE title = 'Gamma Garden'), NULL::uuid, 'read action unavailable without a readable file');
UPDATE works SET user_rating = 1 WHERE id = 'b1000000-1111-0000-0000-000000000001';

SELECT is((SELECT max(total) FROM library_page(p_limit => 1)), 3::bigint, 'total counts every match, not just the page');
SELECT is(ARRAY(SELECT title FROM library_page(p_sort => 'title')), ARRAY['Alpha Garden', 'Beta Machine', 'Gamma Garden'], 'sort by title');
SELECT is(ARRAY(SELECT title FROM library_page(p_sort => 'author')), ARRAY['Gamma Garden', 'Alpha Garden', 'Beta Machine'], 'sort by author sort name, unattributed last');
SELECT is(ARRAY(SELECT title FROM library_page(p_sort => 'published')), ARRAY['Gamma Garden', 'Alpha Garden', 'Beta Machine'], 'sort by publication date, newest first');
SELECT is((SELECT title FROM library_page(p_sort => 'recent') LIMIT 1), 'Gamma Garden', 'recently read comes first');
SELECT is(ARRAY(SELECT title FROM library_page(p_limit => 2, p_offset => 2)), ARRAY['Alpha Garden'], 'pagination continues where the first page stopped');

SELECT is(ARRAY(SELECT title FROM library_page(p_work_type => 'article')), ARRAY['Beta Machine'], 'filter by work type');
SELECT is(ARRAY(SELECT title FROM library_page(p_language => 'de')), ARRAY['Beta Machine'], 'filter by language');
SELECT is(ARRAY(SELECT title FROM library_page(p_tag => 'a4000000-1111-0000-0000-000000000001')), ARRAY['Alpha Garden'], 'filter by tag');
SELECT is(ARRAY(SELECT title FROM library_page(p_collection => 'a5000000-1111-0000-0000-000000000001')), ARRAY['Gamma Garden'], 'filter by collection');
SELECT is(ARRAY(SELECT title FROM library_page(p_status => 'reading')), ARRAY['Gamma Garden'], 'filter by reading status');
SELECT is(ARRAY(SELECT title FROM library_page(p_status => 'unread')), ARRAY['Beta Machine', 'Alpha Garden'], 'works with no reading state are unread');
SELECT is(ARRAY(SELECT title FROM library_page(p_format => 'pdf')), ARRAY['Alpha Garden'], 'filter by file format');
SELECT is(ARRAY(SELECT title FROM library_page(p_ids => ARRAY['a1000000-1111-0000-0000-000000000002']::uuid[])), ARRAY['Beta Machine'], 'filter by ids');

SELECT is(ARRAY(SELECT title FROM library_page(p_q => 'garden', p_sort => 'relevance') ORDER BY title), ARRAY['Alpha Garden', 'Gamma Garden'], 'search finds A''s works and never B''s');
SELECT is(ARRAY(SELECT title FROM library_page(p_q => 'quantum')), ARRAY['Alpha Garden'], 'search matches the text extracted from a file');
SELECT is((SELECT count(*)::int FROM search_library('secrets')), 0, 'B''s file text is invisible to A');
SELECT is(ARRAY(SELECT title FROM library_page(p_q => 'Author')), ARRAY['Gamma Garden', 'Alpha Garden'], 'search matches contributor names');
SELECT is(ARRAY(SELECT title FROM library_page(p_q => 'garden', p_work_type => 'article')), ARRAY[]::text[], 'search and filters combine');

-- Partial and multilingual metadata matches, without losing intact titles.
RESET ROLE;
WITH added AS (
    INSERT INTO works (user_id, work_type, title, abstract) VALUES
        ('aaaaaaaa-1111-0000-0000-000000000000', 'book', 'The Economist style guide', NULL),
        ('aaaaaaaa-1111-0000-0000-000000000000', 'book', 'Electric Vehicle Design', 'Economics textbook'),
        ('aaaaaaaa-1111-0000-0000-000000000000', 'book', 'Türkiye Üzerine Tezler', NULL),
        ('aaaaaaaa-1111-0000-0000-000000000000', 'book', 'Преступление и наказание', NULL),
        ('aaaaaaaa-1111-0000-0000-000000000000', 'book', '中国文学', NULL),
        ('aaaaaaaa-1111-0000-0000-000000000000', 'book', 'الأدب العربي', NULL)
    RETURNING id
) INSERT INTO records (work_id, record_type) SELECT id, 'edition' FROM added;
SET LOCAL ROLE authenticated;
SELECT is((SELECT title FROM library_page(p_q => 'Eco', p_sort => 'relevance') LIMIT 1), 'The Economist style guide', 'partial title matches rank above abstract matches');
SELECT is(ARRAY(SELECT title FROM library_page(p_q => 'Türk')), ARRAY['Türkiye Üzerine Tezler'], 'Turkish partial title search');
SELECT is(ARRAY(SELECT title FROM library_page(p_q => 'turkiye')), ARRAY['Türkiye Üzerine Tezler'], 'accent-insensitive Turkish search');
SELECT is(ARRAY(SELECT title FROM library_page(p_q => U&'Tu\0308rkiye')), ARRAY['Türkiye Üzerine Tezler'], 'decomposed Unicode search');
SELECT is(ARRAY(SELECT title FROM library_page(p_q => 'преступ')), ARRAY['Преступление и наказание'], 'Cyrillic partial search');
SELECT is(ARRAY(SELECT title FROM library_page(p_q => '文学')), ARRAY['中国文学'], 'Chinese substring search');
SELECT is(ARRAY(SELECT title FROM library_page(p_q => 'العربي')), ARRAY['الأدب العربي'], 'Arabic substring search');
SELECT is(ARRAY(SELECT title FROM library_page(p_q => '%')), ARRAY[]::text[], 'percent search stays literal');
SELECT is(ARRAY(SELECT title FROM library_page(p_q => '_')), ARRAY[]::text[], 'underscore search stays literal');
SELECT is(ARRAY(SELECT title FROM library_page(p_q => 'Zed')), ARRAY['Alpha Garden'], 'partial author search');

-- ---------- As user B ----------
SET LOCAL request.jwt.claims = '{"sub": "bbbbbbbb-1111-0000-0000-000000000000", "role": "authenticated"}';
SELECT is(ARRAY(SELECT title FROM library_page()), ARRAY['Garden of B'], 'B sees only B''s library');
SELECT is((SELECT user_rating FROM library_page() WHERE title = 'Garden of B'), NULL::numeric, 'A cannot change B''s rating');
SELECT is((SELECT count(*)::int FROM search_library('Alpha')), 0, 'B cannot search A''s titles');

-- ---------- Signed-out callers cannot use the definer-rights search ----------
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM search_library('garden')$$, '42501', NULL, 'anon cannot execute search_library');

SELECT * FROM finish();
ROLLBACK;
