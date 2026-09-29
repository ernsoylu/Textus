-- library_page() / search_library() / asset_texts: filters, sorts, pagination, file-text search (FR-ORG-3,
-- FR-SRCH-1, NFR-PERF-1) and isolation between users. Runs in a transaction and rolls back.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(23);

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

-- ---------- As user B ----------
SET LOCAL request.jwt.claims = '{"sub": "bbbbbbbb-1111-0000-0000-000000000000", "role": "authenticated"}';
SELECT is(ARRAY(SELECT title FROM library_page()), ARRAY['Garden of B'], 'B sees only B''s library');
SELECT is((SELECT count(*)::int FROM search_library('Alpha')), 0, 'B cannot search A''s titles');

-- ---------- Signed-out callers cannot use the definer-rights search ----------
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM search_library('garden')$$, '42501', NULL, 'anon cannot execute search_library');

SELECT * FROM finish();
ROLLBACK;
