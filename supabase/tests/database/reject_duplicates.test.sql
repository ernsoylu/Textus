-- FR-CAT-5/7: one work per identifier and per file; merge_works folds duplicates. Owner-only and never across users.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(19);

INSERT INTO auth.users (id, email) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000000', 'a@test.local'),
    ('bbbbbbbb-0000-0000-0000-000000000000', 'b@test.local');
-- A: w1 (two records), w2, w3, w4. B: w9.
INSERT INTO works (id, user_id, work_type, title, abstract, user_rating) VALUES
    ('d0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'book', 'Heat Transfer', NULL, NULL),
    ('d0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000000', 'book', 'heat transfer.pdf', 'Kept abstract', 4.5),
    ('d0000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000000', 'book', 'Mythlore', NULL, NULL),
    ('d0000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000000', 'book', 'Upload', NULL, NULL),
    ('d0000000-0000-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-000000000000', 'book', 'Heat Transfer', NULL, NULL);
INSERT INTO records (id, work_id, record_type) VALUES
    ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'edition'),
    ('e0000000-0000-0000-0000-000000000011', 'd0000000-0000-0000-0000-000000000001', 'edition'),
    ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'edition'),
    ('e0000000-0000-0000-0000-000000000022', 'd0000000-0000-0000-0000-000000000002', 'edition'),
    ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 'edition'),
    ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004', 'edition'),
    ('e0000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000009', 'edition');
INSERT INTO assets (id, user_id, bucket, storage_path, file_size, checksum_sha256, mime_type, file_format) VALUES
    ('f0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'documents', 'a/h.pdf', 1, 'h', 'application/pdf', 'pdf'),
    ('f0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000000', 'covers', 'a/c.jpg', 1, 'c', 'image/jpeg', 'image'),
    ('f0000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000000', 'covers', 'a/c2.jpg', 1, 'c2', 'image/jpeg', 'image');
INSERT INTO record_assets (record_id, asset_id, role) VALUES
    ('e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'primary'),
    ('e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'cover'),
    ('e0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000002', 'cover');
INSERT INTO identifiers (record_id, scheme, normalized_value) VALUES
    ('e0000000-0000-0000-0000-000000000001', 'isbn', '9780471457282'),
    ('e0000000-0000-0000-0000-000000000001', 'issn', '0146-9339');

-- Identifier guard
SELECT throws_ok($$INSERT INTO identifiers (record_id, scheme, normalized_value) VALUES ('e0000000-0000-0000-0000-000000000002', 'isbn', '9780471457282')$$,
    'PT409', 'duplicate_work', 'an ISBN already on another work is rejected');
SELECT lives_ok($$INSERT INTO identifiers (record_id, scheme, normalized_value) VALUES ('e0000000-0000-0000-0000-000000000011', 'isbn', '9780471457282')$$,
    'another record of the same work may share it');
SELECT lives_ok($$INSERT INTO identifiers (record_id, scheme, normalized_value) VALUES ('e0000000-0000-0000-0000-000000000003', 'issn', '0146-9339')$$,
    'a shared ISSN is allowed');
SELECT lives_ok($$INSERT INTO identifiers (record_id, scheme, normalized_value) VALUES ('e0000000-0000-0000-0000-000000000009', 'isbn', '9780471457282')$$,
    'another user may hold the same ISBN');
SELECT throws_ok($$UPDATE identifiers SET record_id = 'e0000000-0000-0000-0000-000000000002' WHERE record_id = 'e0000000-0000-0000-0000-000000000011'$$,
    'PT409', 'duplicate_work', 'moving an identifier onto another work is rejected');

-- complete_upload: the same bytes are not linked to a second work
SELECT begin_upload('aaaaaaaa-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004', '{"source":"file"}');
SELECT is(complete_upload('aaaaaaaa-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', '{"role":"primary","filename":""}',
    '{"bucket":"documents","storage_path":"a/h.pdf","file_size":1,"checksum_sha256":"h","mime_type":"application/pdf","file_format":"pdf","processing_state":"pending"}')->>'workId',
    'd0000000-0000-0000-0000-000000000001', 'a file already in another work is reported as a duplicate');
SELECT is_empty($$SELECT 1 FROM record_assets WHERE record_id = 'e0000000-0000-0000-0000-000000000004'$$, 'and is not linked');
SELECT is(complete_upload('aaaaaaaa-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', '{"role":"primary","filename":""}', '{}')->>'status',
    'duplicate', 'a retry returns the stored answer');
SELECT begin_upload('aaaaaaaa-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000011', '{"source":"file"}');
SELECT is(complete_upload('aaaaaaaa-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', '{"role":"supplement","filename":""}',
    '{"bucket":"documents","storage_path":"a/h.pdf","file_size":1,"checksum_sha256":"h","mime_type":"application/pdf","file_format":"pdf","processing_state":"pending"}')->>'status',
    'deduplicated', 'the same work may attach the file again');
SELECT begin_upload('aaaaaaaa-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000004', '{"source":"file"}');
SELECT is(complete_upload('aaaaaaaa-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', '{"role":"cover","filename":""}',
    '{"bucket":"covers","storage_path":"a/c.jpg","file_size":1,"checksum_sha256":"c","mime_type":"image/jpeg","file_format":"image","processing_state":"ready"}')->>'status',
    'deduplicated', 'a shared cover is not a duplicate');

-- merge_works: w1 keeps; w2's e2 shares the file with e1 (folds), e22 is another edition (moves)
INSERT INTO record_assets (record_id, asset_id, role) VALUES
    ('e0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'primary'),
    ('e0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000003', 'cover');
INSERT INTO reading_states (user_id, record_id, status, updated_at) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000001', 'unread', now() - interval '1 day'),
    ('aaaaaaaa-0000-0000-0000-000000000000', 'e0000000-0000-0000-0000-000000000002', 'reading', now());

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000000", "role": "authenticated"}';
SELECT throws_ok($$SELECT merge_works('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002')$$, '42501', NULL, 'B cannot merge A''s works');
SELECT throws_ok($$SELECT merge_works('d0000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000002')$$, '42501', NULL, 'B cannot pull A''s work into its own');
SET LOCAL request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-000000000000", "role": "authenticated", "textus_agent": true}';
SELECT throws_ok($$SELECT merge_works('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002')$$, '42501', NULL, 'agents cannot merge');
SET LOCAL request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-000000000000", "role": "authenticated"}';
SELECT lives_ok($$SELECT merge_works('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002')$$, 'the owner merges');
RESET ROLE;

SELECT is_empty($$SELECT 1 FROM works WHERE id = 'd0000000-0000-0000-0000-000000000002'$$, 'the dropped work is gone');
SELECT results_eq($$SELECT id::text FROM records WHERE work_id = 'd0000000-0000-0000-0000-000000000001' ORDER BY id$$,
    $$VALUES ('e0000000-0000-0000-0000-000000000001'), ('e0000000-0000-0000-0000-000000000011'), ('e0000000-0000-0000-0000-000000000022')$$,
    'the same-file record folds in; the other edition moves');
SELECT results_eq($$SELECT role FROM record_assets WHERE record_id = 'e0000000-0000-0000-0000-000000000001' ORDER BY role$$,
    $$VALUES ('cover'), ('primary')$$, 'the keeper keeps one cover and the file');
SELECT is((SELECT status FROM reading_states WHERE record_id = 'e0000000-0000-0000-0000-000000000001'), 'reading', 'the newer reading state wins');
SELECT is((SELECT abstract || ' ' || user_rating FROM works WHERE id = 'd0000000-0000-0000-0000-000000000001'), 'Kept abstract 4.5', 'empty work fields are filled');

SELECT * FROM finish();
ROLLBACK;
