BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(18);
INSERT INTO auth.users(id,email) VALUES('ab030303-0000-0000-0000-000000000001','background-a@test.local'),('ab030303-0000-0000-0000-000000000002','background-b@test.local');
INSERT INTO public.works(id,user_id,work_type,title,language,metadata) VALUES
 ('ab030303-1000-0000-0000-000000000001','ab030303-0000-0000-0000-000000000001','book','upload.pdf','tr','{"locked_fields":["title","language"]}'),
 ('ab030303-1000-0000-0000-000000000002','ab030303-0000-0000-0000-000000000001','book','Manual title',NULL,'{"locked_fields":["title"]}'),
 ('ab030303-1000-0000-0000-000000000003','ab030303-0000-0000-0000-000000000001','book','Duplicate upload',NULL,'{}');
INSERT INTO public.records(id,work_id,record_type,publisher,metadata) VALUES
 ('ab030303-2000-0000-0000-000000000001','ab030303-1000-0000-0000-000000000001','edition',NULL,'{"locked_fields":["publisher"]}'),
 ('ab030303-2000-0000-0000-000000000002','ab030303-1000-0000-0000-000000000002','edition','Manual publisher','{"locked_fields":["publisher","contributors"]}'),
 ('ab030303-2000-0000-0000-000000000003','ab030303-1000-0000-0000-000000000003','edition',NULL,'{}');
INSERT INTO public.assets(id,user_id,bucket,storage_path,file_size,checksum_sha256,mime_type,file_format,metadata) VALUES
 ('ab030303-3000-0000-0000-000000000001','ab030303-0000-0000-0000-000000000001','documents','upload.pdf',100,'background-test','application/pdf','pdf','{"filename":"upload.pdf"}');
INSERT INTO public.record_assets(record_id,asset_id) VALUES('ab030303-2000-0000-0000-000000000001','ab030303-3000-0000-0000-000000000001');
CREATE TEMP TABLE background_payload AS SELECT '{"suggestion":{"title":"Provider title","source_provider":"openlibrary"},"work":{"title":"Provider title","language":"en","work_type":"book"},"record":{"metadata":{"cover_url":"https://covers.openlibrary.org/b/isbn/9783031662218-L.jpg"},"publisher":"Springer","publication_date":"2024-01-01","publication_date_precision":"year","metadata_source":"openlibrary","metadata_fetched_at":"2026-10-03T00:00:00Z"},"identifiers":[{"scheme":"isbn","value":"9783031662218"}],"credits":[{"kind":"person","display_name":"Jane Writer","family_name":"Writer","given_names":"Jane","sort_name":"Writer, Jane","match_key":"writer","role":"author","credited_as":"Jane Writer","identifiers":{"openlibrary":"OL1234A"}}]}'::jsonb AS value;
GRANT SELECT ON background_payload TO service_role,authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"ab030303-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT throws_ok($$SELECT public.apply_background_metadata('ab030303-0000-0000-0000-000000000001','ab030303-2000-0000-0000-000000000001',(SELECT value FROM background_payload))$$,'42501',NULL,'browser sessions cannot run the worker importer');
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SET LOCAL request.headers='{"x-textus-actor":"job:fetch_metadata"}';
SELECT is(public.apply_background_metadata('ab030303-0000-0000-0000-000000000002','ab030303-2000-0000-0000-000000000001',(SELECT value FROM background_payload)),false,'wrong owner cannot apply metadata');
SELECT throws_ok($$SELECT public.apply_background_metadata('ab030303-0000-0000-0000-000000000001','ab030303-2000-0000-0000-000000000001',jsonb_set((SELECT value FROM background_payload),'{record,metadata_source}','"llm:local"'))$$,'P0001','provider metadata required','AI metadata remains review-only');
SELECT is(public.apply_background_metadata('ab030303-0000-0000-0000-000000000001','ab030303-2000-0000-0000-000000000001',(SELECT value FROM background_payload)),true,'worker imports provider metadata without a page');
SELECT is((SELECT title FROM works WHERE id='ab030303-1000-0000-0000-000000000001'),'Provider title','filename placeholder is replaced');
SELECT is((SELECT language FROM works WHERE id='ab030303-1000-0000-0000-000000000001'),'tr','locked manual language survives');
SELECT is((SELECT publisher FROM records WHERE id='ab030303-2000-0000-0000-000000000001'),'Springer','empty legacy publisher accepts metadata');
SELECT is((SELECT count(*) FROM record_contributors WHERE record_id='ab030303-2000-0000-0000-000000000001'),1::bigint,'author credit is populated');
SELECT is((SELECT count(*) FROM identifiers WHERE record_id='ab030303-2000-0000-0000-000000000001'),1::bigint,'identifier is saved');
SELECT is(public.apply_background_metadata('ab030303-0000-0000-0000-000000000001','ab030303-2000-0000-0000-000000000001',(SELECT value FROM background_payload)),false,'retry does not reapply an imported record');
SELECT is((SELECT count(*) FROM contributors WHERE user_id='ab030303-0000-0000-0000-000000000001'),1::bigint,'retry does not duplicate authors');
SELECT public.apply_background_metadata('ab030303-0000-0000-0000-000000000001','ab030303-2000-0000-0000-000000000002',jsonb_set((SELECT value FROM background_payload),'{identifiers,0,value}','"9781861972712"'));
SELECT is((SELECT title FROM works WHERE id='ab030303-1000-0000-0000-000000000002'),'Manual title','manual title stays locked');
SELECT is((SELECT publisher FROM records WHERE id='ab030303-2000-0000-0000-000000000002'),'Manual publisher','manual publisher stays locked');
SELECT is((SELECT count(*) FROM record_contributors WHERE record_id='ab030303-2000-0000-0000-000000000002'),0::bigint,'locked credits stay untouched');
SELECT public.apply_background_metadata('ab030303-0000-0000-0000-000000000001','ab030303-2000-0000-0000-000000000003',(SELECT value FROM background_payload));
SELECT is((SELECT count(*) FROM works WHERE id='ab030303-1000-0000-0000-000000000003'),0::bigint,'same ISBN upload folds into existing work');
SELECT ok(EXISTS(SELECT 1 FROM work_events WHERE work_id='ab030303-1000-0000-0000-000000000001' AND event='work.updated' AND actor='textus'),'automatic updates retain the background worker actor');
SELECT is((SELECT count(*) FROM jobs WHERE job_type='process_cover' AND payload->>'record_id'='ab030303-2000-0000-0000-000000000001'),1::bigint,'cover is queued once with the catalog transaction');
SELECT is((SELECT metadata->'lookup_suggestions'->'isbn:9783031662218'->'data'->>'title' FROM records WHERE id='ab030303-2000-0000-0000-000000000001'),'Provider title','provider suggestion is retained atomically');
SELECT * FROM finish();
ROLLBACK;
