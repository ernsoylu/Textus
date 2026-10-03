BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);
INSERT INTO auth.users(id,email) VALUES('a0a0a0a0-0000-0000-0000-000000000001','admin@test.local'),('a0a0a0a0-0000-0000-0000-000000000002','member@test.local');
DELETE FROM private.instance_admins;
INSERT INTO private.instance_admins(user_id) VALUES('a0a0a0a0-0000-0000-0000-000000000001');

-- Only instance admins register, list and revoke workers; agent JWTs never do.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a0a0a0a0-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT ok(public.is_instance_admin(),'admin is recognised');
SELECT lives_ok($$INSERT INTO public.workers(id,name,token_hash,token_prefix) VALUES('a0a0a0a0-1000-0000-0000-000000000001','app101',repeat('c',64),'tw_cccccc')$$,'admin registers a worker');
SELECT is((SELECT count(*) FROM public.workers)::int,1,'admin lists workers');
SET LOCAL request.jwt.claims='{"sub":"a0a0a0a0-0000-0000-0000-000000000001","role":"authenticated","textus_agent":"true"}';
SELECT ok(NOT public.is_instance_admin(),'an agent token acting for the admin is not an admin');
SET LOCAL request.jwt.claims='{"sub":"a0a0a0a0-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT ok(NOT public.is_instance_admin(),'member is not an admin');
SELECT is_empty('SELECT id FROM public.workers','member cannot read worker token hashes');
SELECT throws_ok($$INSERT INTO public.workers(name,token_hash,token_prefix) VALUES('rogue',repeat('d',64),'tw_dddddd')$$,'42501',NULL,'member cannot register a worker');
DELETE FROM public.workers;
RESET ROLE;
SELECT is((SELECT count(*) FROM public.workers)::int,1,'member cannot revoke a worker');
SELECT throws_ok($$SET LOCAL ROLE authenticated; SELECT public.claim_jobs()$$,'42501',NULL,'authenticated callers cannot claim jobs');
RESET ROLE;

-- A worker claims only its job types, is recorded on the job, and claims nothing once revoked.
UPDATE public.jobs SET available_at=now()+interval '1 day';
INSERT INTO public.jobs(id,user_id,job_type,payload) VALUES
  ('a0a0a0a0-2000-0000-0000-000000000001','a0a0a0a0-0000-0000-0000-000000000001','embed_passages','{}'),
  ('a0a0a0a0-2000-0000-0000-000000000002','a0a0a0a0-0000-0000-0000-000000000001','fetch_metadata','{}');
SELECT is((SELECT id FROM public.claim_jobs(1,interval '1 minute',ARRAY['fetch_metadata'],'a0a0a0a0-1000-0000-0000-000000000001')),'a0a0a0a0-2000-0000-0000-000000000002'::uuid,'worker claims only its job types');
SELECT is((SELECT worker_id FROM public.jobs WHERE id='a0a0a0a0-2000-0000-0000-000000000002'),'a0a0a0a0-1000-0000-0000-000000000001'::uuid,'claim records the worker');
DELETE FROM public.workers;
SELECT is_empty($$SELECT id FROM public.claim_jobs(1,interval '1 minute',NULL,'a0a0a0a0-1000-0000-0000-000000000001')$$,'revoked worker claims nothing');
SELECT * FROM finish();
ROLLBACK;
