-- Remote job workers (§7.5): containers on other hosts run job-worker's handlers in parallel with the
-- Edge worker. An instance admin registers each one in Settings; the SPA stores only the token's SHA-256
-- hash (as for agent tokens) and the worker-session function exchanges the token for a 10-minute JWT
-- with role textus_worker (below), so revoking a worker stops it within minutes.

-- A worker reads every library's files, so only instance admins may register one.
CREATE TABLE private.instance_admins(user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE);
ALTER TABLE private.instance_admins ENABLE ROW LEVEL SECURITY;
-- No policies: service-only. The oldest account administers the instance; add others with SQL.
INSERT INTO private.instance_admins(user_id) SELECT id FROM auth.users ORDER BY created_at LIMIT 1;

CREATE FUNCTION public.is_instance_admin() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT (SELECT auth.jwt()->>'textus_agent') IS DISTINCT FROM 'true'
    AND EXISTS(SELECT 1 FROM private.instance_admins WHERE user_id=(SELECT auth.uid()))
$$;
REVOKE ALL ON FUNCTION public.is_instance_admin() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_instance_admin() TO authenticated;

CREATE TABLE public.workers(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
  token_hash TEXT NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix TEXT NOT NULL CHECK(token_prefix ~ '^tw_[0-9a-f]{6}$'),
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY workers_admin_select ON public.workers FOR SELECT TO authenticated USING((SELECT public.is_instance_admin()));
CREATE POLICY workers_admin_insert ON public.workers FOR INSERT TO authenticated WITH CHECK((SELECT public.is_instance_admin()));
CREATE POLICY workers_admin_delete ON public.workers FOR DELETE TO authenticated USING((SELECT public.is_instance_admin()));
-- No UPDATE policy: last_seen_at is written by worker-session (service role); a token is never re-pointed.

ALTER TABLE public.jobs ADD COLUMN worker_id UUID REFERENCES public.workers(id) ON DELETE SET NULL;
CREATE INDEX jobs_worker ON public.jobs(worker_id) WHERE worker_id IS NOT NULL;

-- Workers claim only the job types they are configured for; a textus_worker JWT may claim only as itself
-- and never cleanup (which deletes files). The 16-lease cap protects the Edge
-- runtime on the database host, so it counts Edge claims only; each remote worker caps itself
-- (WORKER_CONCURRENCY). A revoked worker claims nothing even before its JWT expires.
DROP FUNCTION public.claim_jobs(INT,INTERVAL);
CREATE FUNCTION public.claim_jobs(p_limit INT DEFAULT 1,p_lease INTERVAL DEFAULT interval '70 seconds',p_types TEXT[] DEFAULT NULL,p_worker UUID DEFAULT NULL)
RETURNS SETOF public.jobs LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_job public.jobs;
BEGIN
  -- ponytail: serialize brief claims globally; split by worker pool if claim throughput matters.
  PERFORM pg_advisory_xact_lock(hashtextextended('textus:claim_jobs',0));
  IF (SELECT auth.role())='textus_worker' AND (p_worker IS DISTINCT FROM (SELECT auth.jwt()->>'textus_worker')::uuid OR p_types IS NULL OR 'cleanup'=ANY(p_types)) THEN
    RAISE EXCEPTION 'Workers claim only as themselves and never cleanup' USING ERRCODE='42501';
  END IF;
  IF p_worker IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.workers WHERE id=p_worker) THEN RETURN; END IF;
  IF p_worker IS NULL AND (SELECT count(*) FROM public.jobs WHERE status='running' AND worker_id IS NULL AND lease_expires_at>clock_timestamp())>=16 THEN RETURN; END IF;
  SELECT j.* INTO v_job FROM public.jobs j WHERE j.attempts<j.max_attempts AND j.available_at<=now()
    AND (j.status='queued' OR (j.status='running' AND j.lease_expires_at<now()))
    AND (p_types IS NULL OR j.job_type=ANY(p_types))
    AND NOT (j.job_type IN ('extract_metadata_ai','embed_passages') AND EXISTS(SELECT 1 FROM public.ai_settings s WHERE s.user_id=j.user_id AND s.ai_queue_paused))
    ORDER BY j.job_type<>'cleanup',j.prioritized_at DESC NULLS LAST,
    (SELECT max(t.started_at) FROM public.jobs t WHERE t.job_type=j.job_type) NULLS FIRST,
    (SELECT max(j2.started_at) FROM public.jobs j2 WHERE j2.user_id IS NOT DISTINCT FROM j.user_id) NULLS FIRST,j.created_at
    LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_job.id IS NULL THEN RETURN; END IF;
  UPDATE public.jobs SET status='running',attempts=attempts+1,claim_generation=claim_generation+1,started_at=now(),lease_expires_at=now()+least(p_lease,interval '2 minutes'),worker_id=p_worker WHERE id=v_job.id RETURNING * INTO v_job;
  IF v_job.job_type='extract_text' THEN UPDATE public.assets SET processing_state='processing',processing_error=NULL WHERE id=(v_job.payload->>'asset_id')::uuid AND user_id=v_job.user_id AND deleting_at IS NULL; END IF;
  RETURN NEXT v_job;
END $$;
REVOKE ALL ON FUNCTION public.claim_jobs(INT,INTERVAL,TEXT[],UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(INT,INTERVAL,TEXT[],UUID) TO service_role;

-- textus_worker: what job handlers need and nothing else — no auth schema, tokens, notes, deletions,
-- workers or cleanup. Queue functions become SECURITY DEFINER (they are service-only and pin search_path),
-- so the role needs EXECUTE on them rather than the tables they touch; the handlers' direct reads and
-- writes get table grants and textus_worker policies scoped to what each job writes.
DO $$ BEGIN CREATE ROLE textus_worker NOLOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT textus_worker TO authenticator;
GRANT USAGE ON SCHEMA public TO textus_worker;
ALTER FUNCTION public.claim_jobs(INT,INTERVAL,TEXT[],UUID) SECURITY DEFINER;
ALTER FUNCTION public.finish_job(UUID,BIGINT,JSONB,TEXT,JSONB) SECURITY DEFINER;
ALTER FUNCTION public.defer_ai_job(UUID,BIGINT,TEXT) SECURITY DEFINER;
ALTER FUNCTION public.merge_extraction_metadata(UUID,UUID,JSONB) SECURITY DEFINER;
ALTER FUNCTION public.commit_passage_batch(UUID,BIGINT,JSONB,INT,INT,TEXT,TEXT) SECURITY DEFINER;
ALTER FUNCTION public.commit_embedding_batch(UUID,BIGINT,JSONB) SECURITY DEFINER;
ALTER FUNCTION public.store_ai_metadata_suggestion(UUID,UUID,UUID,TEXT,JSONB) SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION public.claim_jobs(INT,INTERVAL,TEXT[],UUID), public.finish_job(UUID,BIGINT,JSONB,TEXT,JSONB),
  public.defer_ai_job(UUID,BIGINT,TEXT), public.merge_extraction_metadata(UUID,UUID,JSONB),
  public.commit_passage_batch(UUID,BIGINT,JSONB,INT,INT,TEXT,TEXT), public.commit_embedding_batch(UUID,BIGINT,JSONB),
  public.store_ai_metadata_suggestion(UUID,UUID,UUID,TEXT,JSONB), public.queue_passage_index(UUID,UUID),
  public.apply_background_metadata(UUID,UUID,JSONB), public.acquire_ai_lease(), public.release_ai_lease(UUID) TO textus_worker;

GRANT SELECT ON public.works,public.records,public.record_assets,public.assets,public.ai_settings,public.asset_passages,public.asset_texts,public.metadata_cache TO textus_worker;
GRANT INSERT ON public.assets,public.record_assets,public.jobs,public.asset_texts,public.metadata_cache TO textus_worker;
GRANT UPDATE ON public.asset_texts,public.metadata_cache TO textus_worker;
CREATE POLICY worker_select ON public.works FOR SELECT TO textus_worker USING(true);
CREATE POLICY worker_select ON public.records FOR SELECT TO textus_worker USING(true);
CREATE POLICY worker_select ON public.record_assets FOR SELECT TO textus_worker USING(true);
CREATE POLICY worker_select ON public.assets FOR SELECT TO textus_worker USING(true);
CREATE POLICY worker_select ON public.ai_settings FOR SELECT TO textus_worker USING(true);
CREATE POLICY worker_select ON public.asset_passages FOR SELECT TO textus_worker USING(true);
CREATE POLICY worker_select ON public.asset_texts FOR SELECT TO textus_worker USING(true);
CREATE POLICY worker_select ON public.metadata_cache FOR SELECT TO textus_worker USING(true);
-- process_cover: a cover asset and its link; extract_text: follow-up lookups; search text; provider cache.
CREATE POLICY worker_insert_cover ON public.assets FOR INSERT TO textus_worker WITH CHECK(bucket='covers' AND file_format='image');
CREATE POLICY worker_insert_cover ON public.record_assets FOR INSERT TO textus_worker WITH CHECK(role='cover');
CREATE POLICY worker_insert_lookup ON public.jobs FOR INSERT TO textus_worker WITH CHECK(job_type IN ('fetch_metadata','extract_metadata_ai'));
-- Queueing is idempotent (ON CONFLICT on idempotency_key), which needs SELECT on that column and a SELECT policy.
GRANT SELECT (idempotency_key) ON public.jobs TO textus_worker;
CREATE POLICY worker_select_lookup ON public.jobs FOR SELECT TO textus_worker USING(job_type IN ('fetch_metadata','extract_metadata_ai'));
CREATE POLICY worker_insert ON public.asset_texts FOR INSERT TO textus_worker WITH CHECK(true);
CREATE POLICY worker_update ON public.asset_texts FOR UPDATE TO textus_worker USING(true) WITH CHECK(true);
CREATE POLICY worker_insert ON public.metadata_cache FOR INSERT TO textus_worker WITH CHECK(true);
CREATE POLICY worker_update ON public.metadata_cache FOR UPDATE TO textus_worker USING(true) WITH CHECK(true);

-- Storage: read documents and covers, add covers. Nothing else, and never delete.
GRANT USAGE ON SCHEMA storage TO textus_worker;
GRANT SELECT ON storage.buckets TO textus_worker;
GRANT SELECT,INSERT ON storage.objects TO textus_worker;
CREATE POLICY worker_buckets ON storage.buckets FOR SELECT TO textus_worker USING(id IN ('documents','covers'));
CREATE POLICY worker_read ON storage.objects FOR SELECT TO textus_worker USING(bucket_id IN ('documents','covers'));
CREATE POLICY worker_add_cover ON storage.objects FOR INSERT TO textus_worker WITH CHECK(bucket_id='covers');
