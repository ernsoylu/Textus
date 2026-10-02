-- A run that finds the shared GPU busy was pushed back 5 minutes, so overlapping embedding runs left most books
-- waiting while the GPU had capacity. A busy GPU is retried after 30 seconds; disabled or unreachable AI keeps
-- the 5-minute pause.
CREATE OR REPLACE FUNCTION public.defer_ai_job(p_id UUID,p_generation BIGINT,p_reason TEXT) RETURNS BOOLEAN LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 UPDATE public.jobs SET status='queued',attempts=greatest(0,attempts-1),available_at=now()+CASE WHEN p_reason='ai_busy' THEN interval '30 seconds' ELSE interval '5 minutes' END,lease_expires_at=NULL,result=jsonb_build_object('paused',p_reason)
 WHERE id=p_id AND claim_generation=p_generation AND status='running' AND lease_expires_at>now() AND job_type IN('extract_metadata_ai','embed_passages');
 RETURN FOUND;
END $$;
