-- RLS isolation (FR-AUTH-2, NFR-SEC-1): user B can neither read nor write user A's rows.
-- Runs in a transaction and rolls back. `supabase test db`, or pipe into psql as postgres.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(54);

-- ---------- Fixtures for user A (as postgres, bypassing RLS) ----------
INSERT INTO auth.users (id, email) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000000', 'a@test.local'),
    ('bbbbbbbb-0000-0000-0000-000000000000', 'b@test.local');

INSERT INTO works (id, user_id, work_type, title) VALUES
    ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'book', 'A work');
INSERT INTO records (id, work_id, record_type) VALUES
    ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'edition');
INSERT INTO identifiers (record_id, scheme, normalized_value) VALUES
    ('a0000000-0000-0000-0000-000000000002', 'isbn', '9780134685991');
INSERT INTO contributors (id, user_id, display_name, family_name, sort_name, match_key) VALUES
    ('a0000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000000', 'J. Smith', 'Smith', 'Smith, J.', 'smith'),
    ('a0000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000000', 'John Smith', 'Smith', 'Smith, John', 'smith');
INSERT INTO contributor_names (user_id, contributor_id, name, match_key) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003', 'Smith, J.', 'smith');
INSERT INTO contributor_identifiers (user_id, contributor_id, scheme, value) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003', 'orcid', '0000-0002-1825-0097');
INSERT INTO contributor_distinctions (user_id, contributor_a, contributor_b) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004');
INSERT INTO record_contributors (record_id, contributor_id, role, position) VALUES
    ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'author', 0);
INSERT INTO assets (id, user_id, bucket, storage_path, file_size, checksum_sha256, mime_type, file_format) VALUES
    ('a0000000-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000000', 'documents',
     'aaaaaaaa-0000-0000-0000-000000000000/abc.pdf', 10, 'abc', 'application/pdf', 'pdf');
INSERT INTO record_assets (record_id, asset_id) VALUES
    ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000005');
INSERT INTO tags (id, user_id, name) VALUES
    ('a0000000-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000000', 'fiction');
INSERT INTO record_tags (record_id, tag_id) VALUES
    ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000006');
INSERT INTO collections (id, user_id, name) VALUES
    ('a0000000-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000000', 'Shelf');
INSERT INTO collection_records (collection_id, record_id) VALUES
    ('a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000002');
INSERT INTO reading_states (user_id, record_id) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002');
INSERT INTO annotations (user_id, record_id, asset_id, anchor_type, anchor_data) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002',
     'a0000000-0000-0000-0000-000000000005', 'pdf_page', '{"page": 1}');
INSERT INTO saved_searches (user_id, name) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000000', 'Unread PDFs');
INSERT INTO jobs (user_id, job_type, payload) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000000', 'extract_text', '{}');
INSERT INTO metadata_cache (identifier_scheme, identifier_value, provider, response_data) VALUES
    ('isbn', '9780134685991', 'openlibrary', '{}');
INSERT INTO storage.objects (bucket_id, name) VALUES
    ('documents', 'aaaaaaaa-0000-0000-0000-000000000000/abc.pdf');

-- ---------- Owner sees own rows (policies are not deny-all) ----------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-000000000000", "role": "authenticated"}';
SELECT isnt_empty('SELECT 1 FROM works', 'A sees own works');
SELECT isnt_empty('SELECT 1 FROM identifiers', 'A sees own identifiers');
SELECT isnt_empty('SELECT 1 FROM record_contributors', 'A sees own credits');
SELECT isnt_empty('SELECT 1 FROM saved_searches', 'A sees own saved searches');
SELECT isnt_empty($$SELECT 1 FROM storage.objects WHERE bucket_id = 'documents'$$, 'A sees own documents');

-- ---------- User B: reads ----------
SET LOCAL request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000000", "role": "authenticated"}';
SELECT is_empty('SELECT 1 FROM works', 'B cannot read works');
SELECT is_empty('SELECT 1 FROM records', 'B cannot read records');
SELECT is_empty('SELECT 1 FROM identifiers', 'B cannot read identifiers');
SELECT is_empty('SELECT 1 FROM contributors', 'B cannot read contributors');
SELECT is_empty('SELECT 1 FROM contributor_names', 'B cannot read contributor_names');
SELECT is_empty('SELECT 1 FROM contributor_identifiers', 'B cannot read contributor_identifiers');
SELECT is_empty('SELECT 1 FROM contributor_distinctions', 'B cannot read contributor_distinctions');
SELECT is_empty('SELECT 1 FROM record_contributors', 'B cannot read record_contributors');
SELECT is_empty('SELECT 1 FROM assets', 'B cannot read assets');
SELECT is_empty('SELECT 1 FROM record_assets', 'B cannot read record_assets');
SELECT is_empty('SELECT 1 FROM tags', 'B cannot read tags');
SELECT is_empty('SELECT 1 FROM record_tags', 'B cannot read record_tags');
SELECT is_empty('SELECT 1 FROM collections', 'B cannot read collections');
SELECT is_empty('SELECT 1 FROM collection_records', 'B cannot read collection_records');
SELECT is_empty('SELECT 1 FROM reading_states', 'B cannot read reading_states');
SELECT is_empty('SELECT 1 FROM annotations', 'B cannot read annotations');
SELECT is_empty('SELECT 1 FROM saved_searches', 'B cannot read saved_searches');
SELECT is_empty('SELECT 1 FROM jobs', 'B cannot read jobs');
SELECT is_empty('SELECT 1 FROM storage.objects', 'B cannot read A''s storage objects');
SELECT isnt_empty('SELECT 1 FROM metadata_cache', 'metadata_cache is shared by design');

-- ---------- User B: inserts pointing at A's rows ----------
SELECT throws_ok($$INSERT INTO works (user_id, work_type, title) VALUES ('aaaaaaaa-0000-0000-0000-000000000000', 'book', 'x')$$,
    '42501', NULL, 'B cannot create works for A');
SELECT throws_ok($$INSERT INTO records (work_id, record_type) VALUES ('a0000000-0000-0000-0000-000000000001', 'edition')$$,
    '42501', NULL, 'B cannot add records to A''s work');
SELECT throws_ok($$INSERT INTO identifiers (record_id, scheme, normalized_value) VALUES ('a0000000-0000-0000-0000-000000000002', 'doi', '10.1/x')$$,
    '42501', NULL, 'B cannot add identifiers to A''s record');
SELECT throws_ok($$INSERT INTO contributor_names (user_id, contributor_id, name, match_key) VALUES ('bbbbbbbb-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003', 'x', 'x')$$,
    '42501', NULL, 'B cannot add names to A''s contributor');
SELECT throws_ok($$INSERT INTO contributor_identifiers (user_id, contributor_id, scheme, value) VALUES ('bbbbbbbb-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003', 'isni', 'x')$$,
    '42501', NULL, 'B cannot add identifiers to A''s contributor');
SELECT throws_ok($$INSERT INTO contributor_distinctions (user_id, contributor_a, contributor_b) VALUES ('bbbbbbbb-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004')$$,
    '42501', NULL, 'B cannot record distinctions on A''s contributors');
SELECT throws_ok($$INSERT INTO saved_searches (user_id, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000000', 'x')$$,
    '42501', NULL, 'B cannot create saved searches for A');
SELECT throws_ok($$INSERT INTO record_tags (record_id, tag_id) VALUES ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000006')$$,
    '42501', NULL, 'B cannot tag A''s record');
SELECT throws_ok($$INSERT INTO collection_records (collection_id, record_id) VALUES ('a0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000002')$$,
    '42501', NULL, 'B cannot add to A''s collection');
SELECT throws_ok($$SELECT set_record_contributors('a0000000-0000-0000-0000-000000000002', '[]')$$,
    'P0001', 'record not found', 'B cannot replace A''s credits');

-- Junction insert must check BOTH sides: B's own tag on A's record, B's own record with A's contributor.
INSERT INTO works (id, user_id, work_type, title) VALUES
    ('b0000000-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000000', 'book', 'B work');
INSERT INTO records (id, work_id, record_type) VALUES
    ('b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'edition');
INSERT INTO tags (id, user_id, name) VALUES
    ('b0000000-0000-0000-0000-000000000006', 'bbbbbbbb-0000-0000-0000-000000000000', 'mine');
SELECT throws_ok($$INSERT INTO record_contributors (record_id, contributor_id, role, position) VALUES ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'author', 0)$$,
    '42501', NULL, 'B cannot credit A''s contributor on own record');
SELECT throws_ok($$INSERT INTO record_tags (record_id, tag_id) VALUES ('a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000006')$$,
    '42501', NULL, 'B cannot put own tag on A''s record');
SELECT throws_ok($$INSERT INTO records (work_id, container_record_id, record_type) VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'chapter')$$,
    '42501', NULL, 'B cannot nest own record inside A''s record');

-- ---------- Server-only writes are denied to every client ----------
SELECT throws_ok($$INSERT INTO assets (user_id, bucket, storage_path, file_size, checksum_sha256, mime_type, file_format) VALUES ('bbbbbbbb-0000-0000-0000-000000000000', 'documents', 'x', 1, 'x', 'application/pdf', 'pdf')$$,
    '42501', NULL, 'clients cannot create assets');
SELECT throws_ok($$INSERT INTO record_assets (record_id, asset_id) VALUES ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000005')$$,
    '42501', NULL, 'clients cannot link assets');
SELECT throws_ok($$INSERT INTO jobs (user_id, job_type, payload) VALUES ('bbbbbbbb-0000-0000-0000-000000000000', 'cleanup', '{}')$$,
    '42501', NULL, 'clients cannot enqueue jobs');
SELECT throws_ok($$INSERT INTO metadata_cache (identifier_scheme, identifier_value, provider, response_data) VALUES ('doi', 'x', 'crossref', '{}')$$,
    '42501', NULL, 'clients cannot write metadata_cache');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', 'bbbbbbbb-0000-0000-0000-000000000000/x.pdf')$$,
    '42501', NULL, 'clients cannot write storage objects directly');
SELECT throws_ok('SELECT claim_jobs()', '42501', NULL, 'clients cannot claim jobs');

-- ---------- User B: updates and deletes silently touch nothing ----------
-- These are deliberately unscoped (WHERE true): the point is that RLS, not the statement, limits them.
UPDATE works SET title = 'hacked' WHERE true;
UPDATE contributors SET display_name = 'hacked' WHERE true;
UPDATE records SET title = 'hacked' WHERE id = 'a0000000-0000-0000-0000-000000000002';
DELETE FROM works WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000000';
DELETE FROM identifiers WHERE true; DELETE FROM contributors WHERE user_id <> 'bbbbbbbb-0000-0000-0000-000000000000';
DELETE FROM record_contributors WHERE true; DELETE FROM record_assets WHERE true; DELETE FROM record_tags WHERE true;
DELETE FROM collection_records WHERE true; DELETE FROM reading_states WHERE true; UPDATE saved_searches SET name = 'hacked' WHERE true; DELETE FROM saved_searches WHERE true; DELETE FROM annotations WHERE true;

RESET ROLE;
SELECT is((SELECT title FROM works WHERE id = 'a0000000-0000-0000-0000-000000000001'), 'A work', 'A''s work unchanged');
SELECT is((SELECT count(*)::int FROM contributors WHERE display_name = 'hacked'), 0, 'A''s contributors unchanged');
SELECT is((SELECT title FROM records WHERE id = 'a0000000-0000-0000-0000-000000000002'), NULL, 'A''s record unchanged');
SELECT is((SELECT count(*)::int FROM identifiers), 1, 'A''s identifiers survive');
SELECT is((SELECT count(*)::int FROM record_contributors), 1, 'A''s credits survive');
SELECT is((SELECT count(*)::int FROM record_assets), 1, 'A''s asset links survive');
SELECT is((SELECT count(*)::int FROM annotations), 1, 'A''s annotations survive');
SELECT is((SELECT name FROM saved_searches), 'Unread PDFs', 'A''s saved search survives');

-- ---------- Asset immutability holds even for privileged roles ----------
SELECT throws_ok($$UPDATE assets SET checksum_sha256 = 'def' WHERE id = 'a0000000-0000-0000-0000-000000000005'$$,
    'P0001', 'assets are immutable; create a new asset instead', 'asset bytes columns are immutable');
SELECT lives_ok($$UPDATE assets SET processing_state = 'ready' WHERE id = 'a0000000-0000-0000-0000-000000000005'$$,
    'asset processing_state may change');

SELECT * FROM finish();
ROLLBACK;
