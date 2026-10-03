-- Keep the backlog queued; at most 16 jobs may hold live worker leases at once.
CREATE OR REPLACE FUNCTION public.claim_jobs(p_limit INT DEFAULT 1,p_lease INTERVAL DEFAULT interval '70 seconds')
RETURNS SETOF public.jobs LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_job public.jobs;
BEGIN
  -- ponytail: serialize brief claims globally; split by worker pool if claim throughput matters.
  PERFORM pg_advisory_xact_lock(hashtextextended('textus:claim_jobs',0));
  IF (SELECT count(*) FROM public.jobs WHERE status='running' AND lease_expires_at>clock_timestamp())>=16 THEN RETURN; END IF;
  SELECT j.* INTO v_job FROM public.jobs j WHERE j.attempts<j.max_attempts AND j.available_at<=now()
    AND (j.status='queued' OR (j.status='running' AND j.lease_expires_at<now()))
    AND NOT (j.job_type IN ('extract_metadata_ai','embed_passages') AND EXISTS(SELECT 1 FROM public.ai_settings s WHERE s.user_id=j.user_id AND s.ai_queue_paused))
    ORDER BY j.job_type<>'cleanup',j.prioritized_at DESC NULLS LAST,
    CASE WHEN j.job_type IN ('extract_text','process_cover','fetch_metadata') THEN 1 ELSE 2 END,
    (SELECT max(t.started_at) FROM public.jobs t WHERE t.job_type=j.job_type) NULLS FIRST,
    (SELECT max(j2.started_at) FROM public.jobs j2 WHERE j2.user_id IS NOT DISTINCT FROM j.user_id) NULLS FIRST,j.created_at
    LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_job.id IS NULL THEN RETURN; END IF;
  UPDATE public.jobs SET status='running',attempts=attempts+1,claim_generation=claim_generation+1,started_at=now(),lease_expires_at=now()+least(p_lease,interval '2 minutes') WHERE id=v_job.id RETURNING * INTO v_job;
  IF v_job.job_type='extract_text' THEN UPDATE public.assets SET processing_state='processing',processing_error=NULL WHERE id=(v_job.payload->>'asset_id')::uuid AND user_id=v_job.user_id AND deleting_at IS NULL; END IF;
  RETURN NEXT v_job;
END $$;
REVOKE ALL ON FUNCTION public.claim_jobs(INT,INTERVAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_jobs(INT,INTERVAL) TO service_role;

