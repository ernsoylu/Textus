BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(18);
INSERT INTO auth.users(id,email) VALUES('a0a0a0a0-0000-0000-0000-000000000001','admin@test.local'),('a0a0a0a0-0000-0000-0000-000000000002','member@test.local');
DELETE FROM private.instance_admins WHERE user_id<>'a0a0a0a0-0000-0000-0000-000000000001';
-- pgTAP lives in extensions; the worker role needs to call it here (rolled back with the test).
GRANT USAGE ON SCHEMA extensions TO textus_worker;
INSERT INTO private.instance_admins(user_id) VALUES('a0a0a0a0-0000-0000-0000-000000000001');

-- Only instance admins register, list and revoke workers; agent JWTs never do.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"a0a0a0a0-0000-0000-0000-000000000001","role":"authenticated"}';
SELECT ok(public.is_instance_admin(),'admin is recognised');
SELECT lives_ok($$INSERT INTO public.workers(id,name,token_hash,token_prefix) VALUES('a0a0a0a0-1000-0000-0000-000000000001','app101',repeat('c',64),'tw_cccccc')$$,'admin registers a worker');
SELECT is((SELECT count(*) FROM public.workers WHERE id='a0a0a0a0-1000-0000-0000-000000000001')::int,1,'admin lists workers');
SET LOCAL request.jwt.claims='{"sub":"a0a0a0a0-0000-0000-0000-000000000001","role":"authenticated","textus_agent":"true"}';
SELECT ok(NOT public.is_instance_admin(),'an agent token acting for the admin is not an admin');
SET LOCAL request.jwt.claims='{"sub":"a0a0a0a0-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT ok(NOT public.is_instance_admin(),'member is not an admin');
SELECT is_empty('SELECT id FROM public.workers','member cannot read worker token hashes');
SELECT throws_ok($$INSERT INTO public.workers(name,token_hash,token_prefix) VALUES('rogue',repeat('d',64),'tw_dddddd')$$,'42501',NULL,'member cannot register a worker');
DELETE FROM public.workers WHERE id='a0a0a0a0-1000-0000-0000-000000000001';
RESET ROLE;
SELECT is((SELECT count(*) FROM public.workers WHERE id='a0a0a0a0-1000-0000-0000-000000000001')::int,1,'member cannot revoke a worker');
SELECT throws_ok($$SET LOCAL ROLE authenticated; SELECT public.claim_jobs()$$,'42501',NULL,'authenticated callers cannot claim jobs');
RESET ROLE;

-- A worker claims only its job types, is recorded on the job, and claims nothing once revoked.
UPDATE public.jobs SET available_at=now()+interval '1 day';
INSERT INTO public.jobs(id,user_id,job_type,payload) VALUES
  ('a0a0a0a0-2000-0000-0000-000000000001','a0a0a0a0-0000-0000-0000-000000000001','embed_passages','{}'),
  ('a0a0a0a0-2000-0000-0000-000000000002','a0a0a0a0-0000-0000-0000-000000000001','fetch_metadata','{}');
SELECT is((SELECT id FROM public.claim_jobs(1,interval '1 minute',ARRAY['fetch_metadata'],'a0a0a0a0-1000-0000-0000-000000000001')),'a0a0a0a0-2000-0000-0000-000000000002'::uuid,'worker claims only its job types');
SELECT is((SELECT worker_id FROM public.jobs WHERE id='a0a0a0a0-2000-0000-0000-000000000002'),'a0a0a0a0-1000-0000-0000-000000000001'::uuid,'claim records the worker');

-- A worker JWT (role textus_worker) claims only as itself, never cleanup, and cannot reach tokens, notes or deletions.
SET LOCAL ROLE textus_worker;
SET LOCAL request.jwt.claims='{"role":"textus_worker","textus_worker":"a0a0a0a0-1000-0000-0000-000000000001"}';
SELECT throws_ok($$SELECT public.claim_jobs(1,interval '1 minute',ARRAY['cleanup'],'a0a0a0a0-1000-0000-0000-000000000001')$$,'42501',NULL,'worker cannot claim cleanup');
SELECT throws_ok($$SELECT public.claim_jobs(1,interval '1 minute',ARRAY['fetch_metadata'],'a0a0a0a0-1000-0000-0000-000000000009')$$,'42501',NULL,'worker cannot claim as another worker');
SELECT throws_ok($$SELECT id FROM public.agent_tokens$$,'42501',NULL,'worker cannot read agent tokens');
SELECT throws_ok($$SELECT payload FROM public.jobs$$,'42501',NULL,'worker cannot read job payloads');
SELECT throws_ok($$DELETE FROM public.works WHERE user_id='a0a0a0a0-0000-0000-0000-000000000001'$$,'42501',NULL,'worker cannot delete works');
SELECT lives_ok($$INSERT INTO public.jobs(user_id,job_type,payload,idempotency_key) VALUES('a0a0a0a0-0000-0000-0000-000000000001','fetch_metadata','{}','worker-test') ON CONFLICT(idempotency_key) DO NOTHING$$,'worker queues an idempotent metadata lookup');
RESET ROLE;
SET LOCAL request.jwt.claims='{}';
DELETE FROM public.workers WHERE id='a0a0a0a0-1000-0000-0000-000000000001';
SELECT is_empty($$SELECT id FROM public.claim_jobs(1,interval '1 minute',NULL,'a0a0a0a0-1000-0000-0000-000000000001')$$,'revoked worker claims nothing');
SELECT * FROM finish();
ROLLBACK;
