-- Owners can pause their AI background work (embeddings and AI metadata) from Activity, so their own questions
-- get the shared GPU while a large re-embedding runs. Queued jobs stay queued; a run already holding the GPU
-- finishes its batch. Other job types are unaffected. The existing owner policy covers the new column.
ALTER TABLE public.ai_settings ADD COLUMN ai_queue_paused BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.claim_jobs(p_limit INT DEFAULT 1,p_lease INTERVAL DEFAULT interval '70 seconds')
RETURNS SETOF public.jobs LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_job public.jobs;
BEGIN
  SELECT j.* INTO v_job FROM public.jobs j WHERE j.attempts<j.max_attempts AND j.available_at<=now()
    AND (j.status='queued' OR (j.status='running' AND j.lease_expires_at<now()))
    AND NOT (j.job_type IN ('extract_metadata_ai','embed_passages') AND EXISTS(SELECT 1 FROM public.ai_settings s WHERE s.user_id=j.user_id AND s.ai_queue_paused))
    ORDER BY CASE WHEN j.job_type='cleanup' THEN 0 WHEN j.job_type IN ('extract_text','process_cover','fetch_metadata') THEN 1 ELSE 2 END,
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
