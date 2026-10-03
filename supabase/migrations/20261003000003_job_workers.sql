-- Remote job workers (§7.5): containers on other hosts run job-worker's handlers in parallel with the
-- Edge worker. An instance admin registers each one in Settings; the SPA stores only the token's SHA-256
-- hash (as for agent tokens) and the worker-session function exchanges the token for a 10-minute
-- service-role JWT, so revoking a worker stops it within minutes.

-- A worker holds service-role access to every library, so only instance admins may register one.
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

-- Workers claim only the job types they are configured for. The 16-lease cap protects the Edge
-- runtime on the database host, so it counts Edge claims only; each remote worker caps itself
-- (WORKER_CONCURRENCY). A revoked worker claims nothing even before its JWT expires.
DROP FUNCTION public.claim_jobs(INT,INTERVAL);
CREATE FUNCTION public.claim_jobs(p_limit INT DEFAULT 1,p_lease INTERVAL DEFAULT interval '70 seconds',p_types TEXT[] DEFAULT NULL,p_worker UUID DEFAULT NULL)
RETURNS SETOF public.jobs LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_job public.jobs;
BEGIN
  -- ponytail: serialize brief claims globally; split by worker pool if claim throughput matters.
  PERFORM pg_advisory_xact_lock(hashtextextended('textus:claim_jobs',0));
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
