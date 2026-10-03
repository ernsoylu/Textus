BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(32);
INSERT INTO auth.users(id,email) VALUES('fafafafa-0000-0000-0000-000000000001','fairness@test.local');
UPDATE public.jobs SET available_at=now()+interval '1 day';
-- An older, continuously re-queued indexing job must not starve a newer embedding job.
INSERT INTO public.jobs(id,user_id,job_type,payload,created_at,started_at) VALUES
  ('fafafafa-1000-0000-0000-000000000001','fafafafa-0000-0000-0000-000000000001','index_passages','{}',now()-interval '2 hours',now()-interval '1 minute'),
  ('fafafafa-1000-0000-0000-000000000002','fafafafa-0000-0000-0000-000000000001','embed_passages','{}',now(),NULL);
SELECT is((SELECT id FROM public.claim_jobs()),'fafafafa-1000-0000-0000-000000000002'::uuid,'embedding runs before the long-running indexing type repeats');
SELECT is((SELECT id FROM public.claim_jobs()),'fafafafa-1000-0000-0000-000000000001'::uuid,'indexing gets the next turn');
-- Retrying a failed index clears the trigger's failure message so a full retry can finish complete.
INSERT INTO public.works(id,user_id,work_type,title) VALUES('fafafafa-2000-0000-0000-000000000001','fafafafa-0000-0000-0000-000000000001','book','Retry book');
INSERT INTO public.records(id,work_id,record_type) VALUES('fafafafa-3000-0000-0000-000000000001','fafafafa-2000-0000-0000-000000000001','edition');
INSERT INTO public.assets(id,user_id,bucket,storage_path,file_size,checksum_sha256,mime_type,file_format) VALUES('fafafafa-4000-0000-0000-000000000001','fafafafa-0000-0000-0000-000000000001','documents','retry.pdf',100,'retry-test','application/pdf','pdf');
INSERT INTO public.record_assets(record_id,asset_id) VALUES('fafafafa-3000-0000-0000-000000000001','fafafafa-4000-0000-0000-000000000001');
SELECT public.queue_passage_index('fafafafa-4000-0000-0000-000000000001','fafafafa-0000-0000-0000-000000000001');
UPDATE public.jobs SET status='failed',attempts=max_attempts WHERE job_type='index_passages' AND payload->>'asset_id'='fafafafa-4000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"fafafafa-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(public.control_passage_index('retry','fafafafa-4000-0000-0000-000000000001'),1,'owner retries the failed index');
RESET ROLE;
SELECT is((SELECT metadata->'passage_index'->'reason' FROM public.assets WHERE id='fafafafa-4000-0000-0000-000000000001'),NULL,'retry clears the failure message');
-- One embedding run checkpoints several four-passage Ollama calls together.
INSERT INTO public.asset_passages(asset_id,user_id,index_version,ordinal,content)
  SELECT 'fafafafa-4000-0000-0000-000000000001','fafafafa-0000-0000-0000-000000000001',metadata->'passage_index'->>'version',n,'Checkpoint passage '||n
  FROM public.assets, generate_series(1,10) n WHERE id='fafafafa-4000-0000-0000-000000000001';
INSERT INTO public.jobs(id,user_id,job_type,payload,status,claim_generation,lease_expires_at)
  SELECT 'fafafafa-1000-0000-0000-000000000003','fafafafa-0000-0000-0000-000000000001','embed_passages',
    jsonb_build_object('asset_id',id,'index_version',metadata->'passage_index'->>'version','digest',repeat('b',64)),'running',1,now()+interval '1 minute'
  FROM public.assets WHERE id='fafafafa-4000-0000-0000-000000000001';
SELECT is(public.commit_embedding_batch('fafafafa-1000-0000-0000-000000000003',1,
  (SELECT jsonb_agg(jsonb_build_object('id',id,'embedding',array_prepend(1::real,array_fill(0::real,ARRAY[767]))::extensions.vector::text)) FROM public.asset_passages WHERE asset_id='fafafafa-4000-0000-0000-000000000001')),
  true,'ten vectors commit in one checkpoint');
-- Up to 256 vectors fit one embedding checkpoint.
INSERT INTO public.asset_passages(asset_id,user_id,index_version,ordinal,content)
  SELECT 'fafafafa-4000-0000-0000-000000000001','fafafafa-0000-0000-0000-000000000001',metadata->'passage_index'->>'version',1000+n,'Bulk checkpoint passage '||n
  FROM public.assets, generate_series(1,200) n WHERE id='fafafafa-4000-0000-0000-000000000001';
INSERT INTO public.jobs(id,user_id,job_type,payload,status,claim_generation,lease_expires_at)
  SELECT 'fafafafa-1000-0000-0000-000000000005','fafafafa-0000-0000-0000-000000000001','embed_passages',
    jsonb_build_object('asset_id',id,'index_version',metadata->'passage_index'->>'version','digest',repeat('c',64)),'running',1,now()+interval '1 minute'
  FROM public.assets WHERE id='fafafafa-4000-0000-0000-000000000001';
SELECT is(public.commit_embedding_batch('fafafafa-1000-0000-0000-000000000005',1,
  (SELECT jsonb_agg(jsonb_build_object('id',id,'embedding',array_prepend(1::real,array_fill(0::real,ARRAY[767]))::extensions.vector::text)) FROM public.asset_passages WHERE ordinal>=1000 AND asset_id='fafafafa-4000-0000-0000-000000000001')),
  true,'200 vectors commit in one checkpoint');
-- One large EPUB content document can produce more than 128 passages in a single batch.
INSERT INTO public.jobs(id,user_id,job_type,payload,status,claim_generation,lease_expires_at)
  SELECT 'fafafafa-1000-0000-0000-000000000004','fafafafa-0000-0000-0000-000000000001','index_passages',
    jsonb_build_object('asset_id',id,'index_version',metadata->'passage_index'->>'version'),'running',1,now()+interval '1 minute'
  FROM public.assets WHERE id='fafafafa-4000-0000-0000-000000000001';
SELECT is(public.commit_passage_batch('fafafafa-1000-0000-0000-000000000004',1,
  (SELECT jsonb_agg(jsonb_build_object('ordinal',100+n,'section',0,'content','Large section passage '||n)) FROM generate_series(1,300) n),1,2),
  true,'a 300-passage section commits in one batch');
-- A busy GPU is retried soon; unavailable AI pauses longer.
INSERT INTO public.jobs(id,user_id,job_type,payload,status,claim_generation,lease_expires_at) VALUES
  ('fafafafa-1000-0000-0000-000000000006','fafafafa-0000-0000-0000-000000000001','embed_passages','{}','running',1,now()+interval '1 minute'),
  ('fafafafa-1000-0000-0000-000000000007','fafafafa-0000-0000-0000-000000000001','embed_passages','{}','running',1,now()+interval '1 minute');
SELECT public.defer_ai_job('fafafafa-1000-0000-0000-000000000006',1,'ai_busy'), public.defer_ai_job('fafafafa-1000-0000-0000-000000000007',1,'ai_unreachable');
SELECT ok((SELECT available_at FROM public.jobs WHERE id='fafafafa-1000-0000-0000-000000000006') <= now()+interval '30 seconds','a busy GPU retries within 30 seconds');
SELECT ok((SELECT available_at FROM public.jobs WHERE id='fafafafa-1000-0000-0000-000000000007') >= now()+interval '5 minutes','unreachable AI still pauses for 5 minutes');
-- The daily cleanup runs as service_role, which cannot read auth.users itself.
SET LOCAL ROLE service_role;
SELECT lives_ok('SELECT count(*) FROM public.claim_storage_cleanup(10)','service_role can claim storage cleanup');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT count(*) FROM public.claim_storage_cleanup(10)','42501',NULL,'users cannot claim storage cleanup');
RESET ROLE;
-- A paused owner's AI jobs wait; their other jobs still run, and AI work resumes when started again.
UPDATE public.jobs SET available_at=now()+interval '1 day';
INSERT INTO public.ai_settings(user_id,ai_queue_paused) VALUES('fafafafa-0000-0000-0000-000000000001',true);
INSERT INTO public.jobs(id,user_id,job_type,payload) VALUES
  ('fafafafa-1000-0000-0000-000000000008','fafafafa-0000-0000-0000-000000000001','embed_passages','{}'),
  ('fafafafa-1000-0000-0000-000000000009','fafafafa-0000-0000-0000-000000000001','index_passages','{}');
SELECT is((SELECT id FROM public.claim_jobs()),'fafafafa-1000-0000-0000-000000000009'::uuid,'paused AI queue still runs indexing');
SELECT is((SELECT count(*) FROM public.claim_jobs()),0::bigint,'paused AI queue holds embedding');
UPDATE public.ai_settings SET ai_queue_paused=false WHERE user_id='fafafafa-0000-0000-0000-000000000001';
SELECT is((SELECT id FROM public.claim_jobs()),'fafafafa-1000-0000-0000-000000000008'::uuid,'started AI queue claims embedding');
-- Moving a book to the top runs its jobs before older ones and puts it first in the Activity queue.
UPDATE public.jobs SET available_at=now()+interval '1 day';
INSERT INTO auth.users(id,email) VALUES('fafafafa-0000-0000-0000-000000000002','other-queue@test.local');
INSERT INTO public.jobs(id,user_id,job_type,payload,created_at) VALUES
  ('fafafafa-1000-0000-0000-000000000010','fafafafa-0000-0000-0000-000000000001','index_passages','{"asset_id":"fafafafa-4000-0000-0000-000000000009"}',now()-interval '1 hour'),
  ('fafafafa-1000-0000-0000-000000000011','fafafafa-0000-0000-0000-000000000001','index_passages','{"asset_id":"fafafafa-4000-0000-0000-000000000001"}',now());
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"fafafafa-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT throws_ok($$SELECT public.move_to_top('fafafafa-4000-0000-0000-000000000001')$$,'42501',NULL,'another owner cannot move the book');
SET LOCAL request.jwt.claims='{"sub":"fafafafa-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(public.move_to_top('fafafafa-4000-0000-0000-000000000001'),(SELECT count(*)::int FROM public.jobs WHERE payload->>'asset_id'='fafafafa-4000-0000-0000-000000000001' AND status IN('queued','running')),'owner moves every queued or running job of the book');
SELECT is((SELECT queue_ahead FROM public.activity_overview() WHERE asset_id='fafafafa-4000-0000-0000-000000000001'),0,'moved book is first in the Activity queue');
RESET ROLE;
UPDATE public.jobs SET available_at=now() WHERE id IN('fafafafa-1000-0000-0000-000000000010','fafafafa-1000-0000-0000-000000000011');
SELECT is((SELECT id FROM public.claim_jobs()),'fafafafa-1000-0000-0000-000000000011'::uuid,'moved job is claimed before an older one');
-- Saturation delays indexing rather than failing a successfully read file.
UPDATE public.jobs SET status='cancelled' WHERE user_id='fafafafa-0000-0000-0000-000000000001' AND status IN('queued','running');
UPDATE public.assets SET metadata='{}',processing_state='ready' WHERE id='fafafafa-4000-0000-0000-000000000001';
INSERT INTO public.jobs(user_id,job_type,payload) SELECT 'fafafafa-0000-0000-0000-000000000001','cleanup','{}' FROM generate_series(1,500);
SELECT is(public.queue_passage_index('fafafafa-4000-0000-0000-000000000001','fafafafa-0000-0000-0000-000000000001'),false,'full queue defers automatic indexing');
SELECT is((SELECT processing_state FROM public.assets WHERE id='fafafafa-4000-0000-0000-000000000001'),'ready','queue pressure leaves the file readable');
SELECT is((SELECT metadata->'passage_index' FROM public.assets WHERE id='fafafafa-4000-0000-0000-000000000001'),NULL,'deferred file stays eligible for automatic scheduling');
DELETE FROM public.jobs WHERE user_id='fafafafa-0000-0000-0000-000000000001' AND job_type='cleanup';
SELECT is(public.queue_passage_index('fafafafa-4000-0000-0000-000000000001','fafafafa-0000-0000-0000-000000000001'),true,'automatic scheduling succeeds when capacity returns');
CREATE TEMP TABLE retry_checkpoint AS SELECT metadata->'passage_index' AS value FROM public.assets WHERE id='fafafafa-4000-0000-0000-000000000001';
INSERT INTO public.jobs(id,user_id,job_type,payload,status,attempts) VALUES('fafafafa-1000-0000-0000-000000000012','fafafafa-0000-0000-0000-000000000001','extract_text','{"asset_id":"fafafafa-4000-0000-0000-000000000001","filename":"retry.pdf"}','failed',3);
UPDATE public.assets SET processing_state='failed',processing_error='Text extraction failed. Retry from Activity.' WHERE id='fafafafa-4000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"fafafafa-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT is(public.control_passage_index('retry','fafafafa-4000-0000-0000-000000000001'),0,'another owner cannot retry extraction');
SET LOCAL request.jwt.claims='{"sub":"fafafafa-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT is(public.control_passage_index('retry','fafafafa-4000-0000-0000-000000000001'),1,'owner can retry extraction');
RESET ROLE;
SELECT is((SELECT status FROM public.jobs WHERE id='fafafafa-1000-0000-0000-000000000012'),'queued','failed extraction is queued again');
SELECT is((SELECT processing_state FROM public.assets WHERE id='fafafafa-4000-0000-0000-000000000001'),'pending','retry resets the read state');
SELECT is((SELECT metadata->'passage_index' FROM public.assets WHERE id='fafafafa-4000-0000-0000-000000000001'),(SELECT value FROM retry_checkpoint),'extraction retry preserves the index checkpoint');
-- Reading a large upload backlog must not starve AI work.
UPDATE public.jobs SET available_at=now()+interval '1 day';
UPDATE public.jobs SET started_at=NULL WHERE job_type='embed_passages';
INSERT INTO public.jobs(id,user_id,job_type,payload,created_at,started_at) VALUES
 ('fafafafa-1000-0000-0000-000000000014','fafafafa-0000-0000-0000-000000000001','extract_text','{}',now()-interval '1 hour',now()),
 ('fafafafa-1000-0000-0000-000000000015','fafafafa-0000-0000-0000-000000000001','embed_passages','{}',now(),NULL);
SELECT is((SELECT id FROM public.claim_jobs()),'fafafafa-1000-0000-0000-000000000015'::uuid,'AI gets a turn during an extraction backlog');
SELECT is((SELECT id FROM public.claim_jobs()),'fafafafa-1000-0000-0000-000000000014'::uuid,'extraction still gets the next turn');
-- Only live leases count toward the global 16-worker limit.
UPDATE public.jobs SET status='cancelled' WHERE status IN('queued','running');
INSERT INTO public.jobs(user_id,job_type,payload,status,attempts,lease_expires_at)
 SELECT 'fafafafa-0000-0000-0000-000000000001','cleanup','{}','running',1,clock_timestamp()+interval '1 minute' FROM generate_series(1,16);
INSERT INTO public.jobs(id,user_id,job_type,payload) VALUES('fafafafa-1000-0000-0000-000000000013','fafafafa-0000-0000-0000-000000000001','cleanup','{}');
SELECT is((SELECT count(*) FROM public.claim_jobs()),0::bigint,'16 live workers prevent another claim');
UPDATE public.jobs SET lease_expires_at=now()-interval '1 second',attempts=max_attempts WHERE id=(SELECT id FROM public.jobs WHERE status='running' LIMIT 1);
SELECT is((SELECT id FROM public.claim_jobs()),'fafafafa-1000-0000-0000-000000000013'::uuid,'an expired lease frees a worker slot');
SELECT is((SELECT count(*) FROM public.jobs WHERE status='running' AND lease_expires_at>clock_timestamp()),16::bigint,'claim fills only the available worker slot');
SELECT * FROM finish();
ROLLBACK;
