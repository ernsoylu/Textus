BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(25);
INSERT INTO auth.users(id,email) VALUES('b1b1b1b1-0000-0000-0000-000000000001','history-a@test.local'),('b1b1b1b1-0000-0000-0000-000000000002','history-b@test.local');
INSERT INTO public.agent_tokens(id,user_id,name,token_hash,token_prefix,scope) VALUES('b1b1b1b1-4000-0000-0000-000000000001','b1b1b1b1-0000-0000-0000-000000000001','Hermes',repeat('b',64),'tx_bbbbbb','read_write');
INSERT INTO public.contributors(id,user_id,display_name,family_name,sort_name,match_key) VALUES
  ('b1b1b1b1-5000-0000-0000-000000000001','b1b1b1b1-0000-0000-0000-000000000001','Ada Author','Author','Author, Ada','author ada'),
  ('b1b1b1b1-5000-0000-0000-000000000002','b1b1b1b1-0000-0000-0000-000000000001','Bea Editor','Editor','Editor, Bea','editor bea');
CREATE TEMP TABLE ev AS SELECT 0::bigint n;
GRANT SELECT ON ev TO authenticated;
-- The owner's own changes.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims='{"sub":"b1b1b1b1-0000-0000-0000-000000000001","role":"authenticated"}';
INSERT INTO public.works(id,user_id,work_type,title) VALUES('b1b1b1b1-1000-0000-0000-000000000001','b1b1b1b1-0000-0000-0000-000000000001','book','Draft Title');
INSERT INTO public.records(id,work_id,record_type,title) VALUES('b1b1b1b1-2000-0000-0000-000000000001','b1b1b1b1-1000-0000-0000-000000000001','edition','Draft Title');
SELECT is((SELECT actor||'|'||event FROM public.work_events WHERE work_id='b1b1b1b1-1000-0000-0000-000000000001' AND event='work.created'),'user|work.created','adding a book is logged as the owner');
UPDATE public.works SET title='Final Title' WHERE id='b1b1b1b1-1000-0000-0000-000000000001';
SELECT is((SELECT summary FROM public.work_events WHERE event='work.updated' ORDER BY id DESC LIMIT 1),'Changed title from “Draft Title” to “Final Title”','edit summary names the field and both values');
SELECT is((SELECT changes->'title'->>'old' FROM public.work_events WHERE event='work.updated' ORDER BY id DESC LIMIT 1),'Draft Title','old value is kept');
UPDATE public.works SET user_rating=4.5 WHERE id='b1b1b1b1-1000-0000-0000-000000000001';
SELECT is((SELECT summary FROM public.work_events WHERE event='work.rated' ORDER BY id DESC LIMIT 1),'Rated 4.5 ★','ratings read naturally');
UPDATE public.works SET updated_at=now() WHERE id='b1b1b1b1-1000-0000-0000-000000000001';
SELECT is((SELECT count(*)::int FROM public.work_events WHERE work_id='b1b1b1b1-1000-0000-0000-000000000001' AND event='work.updated'),1,'bookkeeping-only updates are not history');
SELECT throws_ok($$INSERT INTO public.work_events(user_id,work_id,actor,event,summary) VALUES('b1b1b1b1-0000-0000-0000-000000000001','b1b1b1b1-1000-0000-0000-000000000001','user','forged','Forged')$$,'42501',NULL,'owners cannot write history');
SELECT throws_ok($$UPDATE public.work_events SET summary='rewritten'$$,'42501',NULL,'owners cannot rewrite history');
SELECT throws_ok($$DELETE FROM public.work_events$$,'42501',NULL,'owners cannot delete history');
-- Reading progress: milestones, not every saved position.
INSERT INTO public.reading_states(user_id,record_id,status,progress_percentage) VALUES('b1b1b1b1-0000-0000-0000-000000000001','b1b1b1b1-2000-0000-0000-000000000001','reading',30);
UPDATE public.reading_states SET progress_percentage=40 WHERE record_id='b1b1b1b1-2000-0000-0000-000000000001';
SELECT is((SELECT string_agg(summary,' / ' ORDER BY id) FROM public.work_events WHERE event LIKE 'reading.%'),'Started reading / Read 25%','reading logs status and 25% steps only');
-- Another owner sees nothing.
SET LOCAL request.jwt.claims='{"sub":"b1b1b1b1-0000-0000-0000-000000000002","role":"authenticated"}';
SELECT is_empty($$SELECT id FROM public.work_events$$,'a second user cannot read the history');
-- An agent acting with its own JWT.
SET LOCAL request.jwt.claims='{"sub":"b1b1b1b1-0000-0000-0000-000000000001","role":"authenticated","textus_agent":true,"textus_token_id":"b1b1b1b1-4000-0000-0000-000000000001"}';
UPDATE public.works SET subtitle='From the agent' WHERE id='b1b1b1b1-1000-0000-0000-000000000001';
SELECT is((SELECT actor||'|'||actor_detail FROM public.work_events ORDER BY id DESC LIMIT 1),'agent|Hermes','agent changes name the agent token');
RESET ROLE;
-- Service-role requests say whom they act for; jobs and the AI are attributed.
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SET LOCAL request.headers='{"x-textus-actor":"job:fetch_metadata"}';
UPDATE public.records SET publisher='Crossref Press',metadata_source='crossref' WHERE id='b1b1b1b1-2000-0000-0000-000000000001';
RESET ROLE;
SELECT is((SELECT actor||'|'||actor_detail||'|'||summary FROM public.work_events ORDER BY id DESC LIMIT 1),'textus|fetch_metadata|Applied metadata from crossref — Changed publisher to “Crossref Press”','provider metadata is attributed to the job and source');
SET LOCAL ROLE service_role;
SET LOCAL request.headers='{"x-textus-actor":"job:extract_metadata_ai"}';
UPDATE public.records SET metadata=jsonb_build_object('lookup_suggestions',jsonb_build_object('llm:qwen3.5:4b',jsonb_build_object('title','AI Title'))) WHERE id='b1b1b1b1-2000-0000-0000-000000000001';
RESET ROLE;
SELECT is((SELECT actor||'|'||actor_detail||'|'||event FROM public.work_events ORDER BY id DESC LIMIT 1),'ai|qwen3.5:4b|ai.suggested','AI suggestions are attributed to the model');
SET LOCAL ROLE service_role;
SET LOCAL request.headers='{"x-textus-actor":"user"}';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
INSERT INTO public.identifiers(record_id,scheme,normalized_value) VALUES('b1b1b1b1-2000-0000-0000-000000000001','isbn','9780306406157');
RESET ROLE;
SELECT is((SELECT actor||'|'||summary FROM public.work_events ORDER BY id DESC LIMIT 1),'user|Added ISBN 9780306406157','service calls made for the owner are the owner''s');
-- Direct SQL is visible as such.
SET LOCAL request.headers='';
SET LOCAL request.jwt.claims='';
UPDATE public.records SET edition='2nd' WHERE id='b1b1b1b1-2000-0000-0000-000000000001';
SELECT is((SELECT actor||'|'||actor_detail FROM public.work_events ORDER BY id DESC LIMIT 1),'textus|database','direct database changes are labelled');
SET LOCAL ROLE service_role;
SELECT throws_ok($$INSERT INTO public.work_events(user_id,work_id,actor,event,summary) VALUES('b1b1b1b1-0000-0000-0000-000000000001','b1b1b1b1-1000-0000-0000-000000000001','textus','forged','Forged')$$,'42501',NULL,'the service role cannot write history directly');
RESET ROLE;
-- Credits: a save that rewrites the same credits logs nothing; a real change logs one net difference.
INSERT INTO public.record_contributors(record_id,contributor_id,role,position) VALUES('b1b1b1b1-2000-0000-0000-000000000001','b1b1b1b1-5000-0000-0000-000000000001','author',0);
SET CONSTRAINTS credit_history IMMEDIATE;
SET CONSTRAINTS credit_history DEFERRED;
SELECT is((SELECT summary FROM public.work_events WHERE event='credits.updated' ORDER BY id DESC LIMIT 1),'Added author Ada Author','first credit logged');
UPDATE ev SET n=(SELECT count(*) FROM public.work_events WHERE event='credits.updated');
DELETE FROM public.record_contributors WHERE record_id='b1b1b1b1-2000-0000-0000-000000000001';
INSERT INTO public.record_contributors(record_id,contributor_id,role,position) VALUES('b1b1b1b1-2000-0000-0000-000000000001','b1b1b1b1-5000-0000-0000-000000000001','author',0);
SET CONSTRAINTS credit_history IMMEDIATE;
SET CONSTRAINTS credit_history DEFERRED;
SELECT is((SELECT count(*) FROM public.work_events WHERE event='credits.updated'),(SELECT n FROM ev),'re-saving identical credits is not a change');
DELETE FROM public.record_contributors WHERE record_id='b1b1b1b1-2000-0000-0000-000000000001';
INSERT INTO public.record_contributors(record_id,contributor_id,role,position) VALUES('b1b1b1b1-2000-0000-0000-000000000001','b1b1b1b1-5000-0000-0000-000000000002','editor',0);
SET CONSTRAINTS credit_history IMMEDIATE;
SELECT is((SELECT summary FROM public.work_events WHERE event='credits.updated' ORDER BY id DESC LIMIT 1),'Added editor Bea Editor; Removed author Ada Author','a credit change is one net event');
SELECT is((SELECT jsonb_array_length(changes->'credits'->'old') FROM public.work_events WHERE event='credits.updated' ORDER BY id DESC LIMIT 1),1,'previous credits are kept');
SET CONSTRAINTS credit_history DEFERRED;
SET LOCAL request.jwt.claims='{"sub":"b1b1b1b1-0000-0000-0000-000000000001","role":"authenticated"}';
DELETE FROM public.record_contributors WHERE record_id='b1b1b1b1-2000-0000-0000-000000000001';
SET LOCAL request.jwt.claims='';
SET LOCAL request.headers='{"x-textus-actor":"job:fetch_metadata"}';
SET CONSTRAINTS credit_history IMMEDIATE;
SET LOCAL request.headers='';
SELECT is((SELECT actor FROM public.work_events WHERE event='credits.updated' ORDER BY id DESC LIMIT 1),'user','credits are credited to whoever changed them, not to the actor at commit');
-- Processing milestones from the file's state.
INSERT INTO public.assets(id,user_id,bucket,storage_path,file_size,checksum_sha256,mime_type,file_format,metadata) VALUES('b1b1b1b1-3000-0000-0000-000000000001','b1b1b1b1-0000-0000-0000-000000000001','documents','history.pdf',2048,'history-test','application/pdf','pdf','{"passage_index":{"version":"v","status":"indexing","done":1,"total":3,"passages":2}}');
INSERT INTO public.record_assets(record_id,asset_id,role) VALUES('b1b1b1b1-2000-0000-0000-000000000001','b1b1b1b1-3000-0000-0000-000000000001','primary');
SELECT is((SELECT summary FROM public.work_events WHERE event='file.added' ORDER BY id DESC LIMIT 1),'Added file (PDF, 2048 bytes)','adding a file is logged');
UPDATE public.assets SET metadata=jsonb_set(metadata,'{passage_index}','{"version":"v","status":"indexing","done":2,"total":3,"passages":4}') WHERE id='b1b1b1b1-3000-0000-0000-000000000001';
UPDATE public.assets SET metadata=jsonb_set(metadata,'{passage_index}','{"version":"v","status":"complete","done":3,"total":3,"passages":6}') WHERE id='b1b1b1b1-3000-0000-0000-000000000001';
SELECT is((SELECT string_agg(summary,' / ' ORDER BY id) FROM public.work_events WHERE event LIKE 'index.%'),'Full text indexed: 3 pages or sections, 6 passages','checkpoints are progress; completion is history');
-- History outlives the book; it goes only with the account.
DELETE FROM public.works WHERE id='b1b1b1b1-1000-0000-0000-000000000001';
SELECT ok((SELECT count(*) FROM public.work_events WHERE work_id='b1b1b1b1-1000-0000-0000-000000000001' AND event='work.deleted')=1
  AND (SELECT count(*) FROM public.work_events WHERE work_id='b1b1b1b1-1000-0000-0000-000000000001')>10,'deleting a book keeps and closes its history');
DELETE FROM auth.users WHERE id='b1b1b1b1-0000-0000-0000-000000000001';
SELECT is((SELECT count(*)::int FROM public.work_events WHERE user_id='b1b1b1b1-0000-0000-0000-000000000001'),0,'account deletion removes its history');
SELECT * FROM finish();
ROLLBACK;
