BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);
-- FR-READ-10 / NFR-REL-5 / acceptance A09: ink payload bounds, owner isolation, idempotent retry, history.
INSERT INTO auth.users(id,email) VALUES('c7c7c7c7-0000-0000-0000-000000000001','ink-a@test.local'),('c7c7c7c7-0000-0000-0000-000000000002','ink-b@test.local');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"c7c7c7c7-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO public.works(id,user_id,work_type,title) VALUES('c7c7c7c7-1000-0000-0000-000000000001','c7c7c7c7-0000-0000-0000-000000000001','book','Ink');
INSERT INTO public.records(id,work_id,record_type,title) VALUES('c7c7c7c7-2000-0000-0000-000000000001','c7c7c7c7-1000-0000-0000-000000000001','edition','Ink');
RESET ROLE;
INSERT INTO public.assets(id,user_id,bucket,storage_path,file_size,checksum_sha256,mime_type,file_format) VALUES('c7c7c7c7-3000-0000-0000-000000000001','c7c7c7c7-0000-0000-0000-000000000001','documents','ink.pdf',10,'ink-test','application/pdf','pdf');
CREATE FUNCTION pg_temp.stroke(data text, id uuid DEFAULT gen_random_uuid()) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$INSERT INTO public.annotations(id,user_id,record_id,asset_id,anchor_type,anchor_data,color) VALUES(%L,'c7c7c7c7-0000-0000-0000-000000000001','c7c7c7c7-2000-0000-0000-000000000001','c7c7c7c7-3000-0000-0000-000000000001','pdf_ink',%L,'black') ON CONFLICT (id) DO UPDATE SET anchor_data = EXCLUDED.anchor_data$q$, id, data)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.stroke(text, uuid) TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"c7c7c7c7-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT lives_ok(pg_temp.stroke('{"v":1,"page":2,"tool":"pen","width":0.003,"points":[[0.1,0.2],[0.3,0.4,0.8]]}', 'c7c7c7c7-4000-0000-0000-000000000001'), 'a valid stroke saves');
SELECT lives_ok(pg_temp.stroke('{"v":1,"page":2,"tool":"pen","width":0.003,"points":[[0.1,0.2],[0.3,0.4,0.8]]}', 'c7c7c7c7-4000-0000-0000-000000000001'), 'retrying with the same client id succeeds');
SELECT is((SELECT count(*)::int FROM public.annotations WHERE anchor_type='pdf_ink'), 1, 'the retry did not create a second stroke');
SELECT throws_ok(pg_temp.stroke('{"v":1,"page":2,"tool":"pen","width":0.003,"points":[[1.2,0.2]]}'), '22023', 'invalid ink stroke', 'coordinates outside the page are rejected');
SELECT throws_ok(pg_temp.stroke('{"v":1,"page":2,"tool":"pen","width":0.003,"points":[]}'), '22023', 'invalid ink stroke', 'an empty stroke is rejected');
SELECT throws_ok(pg_temp.stroke('{"v":1,"page":0,"tool":"pen","width":0.003,"points":[[0,0]]}'), '22023', 'invalid ink stroke', 'page numbers start at 1');
SELECT throws_ok(pg_temp.stroke('{"v":1,"page":1,"tool":"spray","width":0.003,"points":[[0,0]]}'), '22023', 'invalid ink stroke', 'unknown tools are rejected');
SELECT throws_ok(pg_temp.stroke('{"v":1,"page":1,"tool":"pen","width":0.5,"points":[[0,0]]}'), '22023', 'invalid ink stroke', 'oversized widths are rejected');
SELECT throws_ok(pg_temp.stroke('{"v":1,"page":1,"tool":"pen","width":0.003,"points":[[0,0]],"extra":"x"}'), '22023', 'invalid ink stroke', 'unexpected fields are rejected');
SELECT throws_ok(pg_temp.stroke(format('{"v":1,"page":1,"tool":"pen","width":0.003,"points":[%s]}', (SELECT string_agg('[0.5,0.5]', ',') FROM generate_series(1, 2001)))), '22023', 'invalid ink stroke', 'more than 2000 points are rejected');
SELECT is((SELECT count(*)::int FROM public.work_events WHERE event LIKE 'annotation.%'), 0, 'ink strokes are not logged as work history');
-- Another user can neither see nor draw on the first user's asset.
SET LOCAL request.jwt.claims='{"sub":"c7c7c7c7-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT throws_ok($$INSERT INTO public.annotations(user_id,record_id,asset_id,anchor_type,anchor_data) VALUES('c7c7c7c7-0000-0000-0000-000000000002','c7c7c7c7-2000-0000-0000-000000000001','c7c7c7c7-3000-0000-0000-000000000001','pdf_ink','{"v":1,"page":1,"tool":"pen","width":0.003,"points":[[0,0]]}')$$, '42501', NULL, 'a second user cannot draw on the first user''s asset');
SELECT * FROM finish();
ROLLBACK;
