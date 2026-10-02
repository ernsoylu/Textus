-- find_duplicate_works (FR-CAT-7): same file, shared identifier, similar title + same author; never across users.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

INSERT INTO auth.users (id, email) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000000', 'a@test.local'),
    ('bbbbbbbb-0000-0000-0000-000000000000', 'b@test.local');

-- w1 is the target. w2 shares its file, w3 its ISBN, w4 the author and the title with its subtitle folded in, w5 the
-- author and a sequel-like title, w6 the
-- ISSN only, and B's w7 the ISBN (invisible to A).
INSERT INTO works (id, user_id, work_type, title, subtitle) VALUES
    ('d0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'book', 'The Hobbit', 'or There and Back Again'),
    ('d0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000000', 'book', 'hobbit.pdf', NULL),
    ('d0000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000000', 'book', 'Der kleine Hobbit', NULL),
    ('d0000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000000', 'book', 'The Hóbbit, or There and Back Again', NULL),
    ('d0000000-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000000', 'book', 'The Hobbit Returns', NULL),
    ('d0000000-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000000', 'serial', 'Mythlore', NULL),
    ('d0000000-0000-0000-0000-000000000007', 'bbbbbbbb-0000-0000-0000-000000000000', 'book', 'The Hobbit', NULL);
INSERT INTO records (id, work_id, record_type)
SELECT ('e0000000-0000-0000-0000-00000000000' || n)::uuid, ('d0000000-0000-0000-0000-00000000000' || n)::uuid, 'edition'
FROM generate_series(1, 7) n;

INSERT INTO assets (id, user_id, bucket, storage_path, file_size, checksum_sha256, mime_type, file_format) VALUES
    ('f0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'documents', 'a/h.pdf', 1, 'h', 'application/pdf', 'pdf'),
    ('f0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000000', 'covers', 'a/c.jpg', 1, 'c', 'image/jpeg', 'image');
INSERT INTO record_assets (record_id, asset_id, role) VALUES
    ('e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'primary'),
    ('e0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'primary'),
    ('e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'cover'),
    ('e0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000002', 'cover');

-- Legacy duplicates from before identifiers_one_work (20261002000001) must still be reported.
ALTER TABLE identifiers DISABLE TRIGGER identifiers_one_work;
INSERT INTO identifiers (record_id, scheme, normalized_value) VALUES
    ('e0000000-0000-0000-0000-000000000001', 'isbn', '9780261102217'),
    ('e0000000-0000-0000-0000-000000000003', 'isbn', '9780261102217'),
    ('e0000000-0000-0000-0000-000000000007', 'isbn', '9780261102217'),
    ('e0000000-0000-0000-0000-000000000001', 'issn', '0146-9339'),
    ('e0000000-0000-0000-0000-000000000006', 'issn', '0146-9339');
ALTER TABLE identifiers ENABLE TRIGGER identifiers_one_work;

INSERT INTO contributors (id, user_id, display_name, family_name, sort_name, match_key) VALUES
    ('c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000000', 'J. R. R. Tolkien', 'Tolkien', 'Tolkien, J. R. R.', 'tolkien'),
    ('c0000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000000', 'John Ronald Reuel Tolkien', 'Tolkien', 'Tolkien, John Ronald Reuel', 'tolkien');
INSERT INTO record_contributors (record_id, contributor_id, role, position) VALUES
    ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'author', 0),
    ('e0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000002', 'author', 0),
    ('e0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000001', 'author', 0);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-000000000000", "role": "authenticated"}';

SELECT results_eq(
    $$SELECT work_id::text, reason FROM find_duplicate_works('d0000000-0000-0000-0000-000000000001')$$,
    $$VALUES ('d0000000-0000-0000-0000-000000000002', 'same_file'),
             ('d0000000-0000-0000-0000-000000000003', 'identifier'),
             ('d0000000-0000-0000-0000-000000000004', 'title_author')$$,
    'same file, identifier and similar title + author match, strongest first');
SELECT is_empty($$SELECT 1 FROM find_duplicate_works('d0000000-0000-0000-0000-000000000001') WHERE work_id = 'd0000000-0000-0000-0000-000000000005'$$,
    'same author with a sequel-like title, or a shared cover, is not a duplicate');
SELECT is_empty($$SELECT 1 FROM find_duplicate_works('d0000000-0000-0000-0000-000000000001') WHERE work_id = 'd0000000-0000-0000-0000-000000000006'$$,
    'a shared ISSN is not a duplicate');
SELECT is_empty($$SELECT 1 FROM find_duplicate_works('d0000000-0000-0000-0000-000000000001') WHERE work_id = 'd0000000-0000-0000-0000-000000000007'$$,
    'another user''s work is never reported');

SET LOCAL request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000000", "role": "authenticated"}';
SELECT is_empty($$SELECT 1 FROM find_duplicate_works('d0000000-0000-0000-0000-000000000007')$$, 'B sees no matches in A''s library');
SELECT is_empty($$SELECT 1 FROM find_duplicate_works('d0000000-0000-0000-0000-000000000001')$$, 'B cannot probe A''s work');

SELECT * FROM finish();
ROLLBACK;
