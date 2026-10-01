BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);
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
SELECT * FROM finish();
ROLLBACK;
