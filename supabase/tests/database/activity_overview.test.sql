BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);
INSERT INTO auth.users(id,email) VALUES('a7a7a7a7-0000-0000-0000-000000000001','activity-a@test.local'),('a7a7a7a7-0000-0000-0000-000000000002','activity-b@test.local');
INSERT INTO public.works(id,user_id,work_type,title) SELECT ('a7a7a7a7-1000-0000-0000-00000000000'||n)::uuid,'a7a7a7a7-0000-0000-0000-000000000001','book','Book '||n FROM generate_series(1,2) n;
INSERT INTO public.records(id,work_id,record_type) SELECT ('a7a7a7a7-2000-0000-0000-00000000000'||n)::uuid,('a7a7a7a7-1000-0000-0000-00000000000'||n)::uuid,'edition' FROM generate_series(1,2) n;
INSERT INTO public.assets(id,user_id,bucket,storage_path,file_size,checksum_sha256,mime_type,file_format,metadata)
  SELECT ('a7a7a7a7-3000-0000-0000-00000000000'||n)::uuid,'a7a7a7a7-0000-0000-0000-000000000001','documents','activity-'||n||'.pdf',100,'activity-'||n,'application/pdf','pdf',
    jsonb_build_object('passage_index',jsonb_build_object('version','v'||n,'status','queued','done',0,'total',0,'passages',0)) FROM generate_series(1,2) n;
INSERT INTO public.record_assets(record_id,asset_id,role) SELECT ('a7a7a7a7-2000-0000-0000-00000000000'||n)::uuid,('a7a7a7a7-3000-0000-0000-00000000000'||n)::uuid,'primary' FROM generate_series(1,2) n;
INSERT INTO public.jobs(user_id,job_type,payload,status,created_at) VALUES
  ('a7a7a7a7-0000-0000-0000-000000000001','index_passages','{"asset_id":"a7a7a7a7-3000-0000-0000-000000000001","index_version":"v1"}','queued',now()-interval '2 minutes'),
  ('a7a7a7a7-0000-0000-0000-000000000001','index_passages','{"asset_id":"a7a7a7a7-3000-0000-0000-000000000002","index_version":"v2"}','queued',now()-interval '1 minute'),
  ('a7a7a7a7-0000-0000-0000-000000000001','fetch_metadata','{"record_id":"a7a7a7a7-2000-0000-0000-000000000002","scheme":"isbn","value":"9780306406157"}','failed',now()),
  ('a7a7a7a7-0000-0000-0000-000000000001','process_cover','{"record_id":"a7a7a7a7-2000-0000-0000-000000000002","url":"https://example.test/c.jpg"}','queued',now());
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a7a7a7a7-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is((SELECT count(*)::int FROM public.activity_overview()),2,'one row per primary book file');
SELECT is((SELECT queue_ahead FROM public.activity_overview() WHERE asset_id='a7a7a7a7-3000-0000-0000-000000000002'),1,'queue position counts earlier indexing jobs');
SELECT is((SELECT title FROM public.activity_overview() WHERE asset_id='a7a7a7a7-3000-0000-0000-000000000002'),'Book 2','rows carry the catalog title, not the file name');
SELECT is((SELECT pending_steps FROM public.activity_overview() WHERE asset_id='a7a7a7a7-3000-0000-0000-000000000002'),ARRAY['process_cover'],'pending metadata steps are listed');
SELECT is((SELECT failed_steps FROM public.activity_overview() WHERE asset_id='a7a7a7a7-3000-0000-0000-000000000002'),ARRAY['fetch_metadata'],'failed metadata steps are listed');
SET LOCAL request.jwt.claims='{"sub":"a7a7a7a7-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT is_empty($$SELECT asset_id FROM public.activity_overview()$$,'another owner sees no activity');
RESET ROLE;
-- Embedding checkpoints record progress for the page.
INSERT INTO public.asset_passages(asset_id,user_id,index_version,ordinal,content) SELECT 'a7a7a7a7-3000-0000-0000-000000000001','a7a7a7a7-0000-0000-0000-000000000001','v1',n,'Passage '||n FROM generate_series(1,3) n;
INSERT INTO public.jobs(id,user_id,job_type,payload,status,claim_generation,lease_expires_at) VALUES('a7a7a7a7-4000-0000-0000-000000000001','a7a7a7a7-0000-0000-0000-000000000001','embed_passages',
  '{"asset_id":"a7a7a7a7-3000-0000-0000-000000000001","index_version":"v1","digest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}','running',1,now()+interval '1 minute');
SELECT public.commit_embedding_batch('a7a7a7a7-4000-0000-0000-000000000001',1,(SELECT jsonb_agg(jsonb_build_object('id',id,'embedding',array_prepend(1::real,array_fill(0::real,ARRAY[767]))::extensions.vector::text))
  FROM (SELECT id FROM public.asset_passages WHERE asset_id='a7a7a7a7-3000-0000-0000-000000000001' ORDER BY id LIMIT 2) x));
SELECT is((SELECT metadata->'embedding_index' FROM public.assets WHERE id='a7a7a7a7-3000-0000-0000-000000000001'),
  '{"digest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","status":"indexing","embedded":2,"total":3}'::jsonb,'embedding progress is recorded per file');
SELECT * FROM finish();
ROLLBACK;
