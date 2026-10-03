-- Owners can move a book to the top of the queue from Activity. Its queued indexing/AI jobs get prioritized_at;
-- claim_jobs() runs the most recently moved jobs first (after cleanup), and continuations keep the stamp because
-- they reuse the job row. activity_overview() reports each book's position across indexing and AI work.
-- ponytail: a moved job also jumps other owners' jobs; add per-owner turns if the instance gets many users.
ALTER TABLE public.jobs ADD COLUMN prioritized_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.claim_jobs(p_limit INT DEFAULT 1,p_lease INTERVAL DEFAULT interval '70 seconds')
RETURNS SETOF public.jobs LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_job public.jobs;
BEGIN
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

-- Owner sessions only, like control_passage_index(); returns how many queued or running jobs moved.
CREATE FUNCTION public.move_to_top(p_asset UUID) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n INT;
BEGIN
 IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'textus_agent','false')='true' THEN RAISE EXCEPTION 'owner session required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.assets WHERE id=p_asset AND user_id=auth.uid() AND deleting_at IS NULL) THEN RAISE EXCEPTION 'asset not found' USING ERRCODE='42501'; END IF;
 UPDATE public.jobs SET prioritized_at=clock_timestamp()
  WHERE user_id=auth.uid() AND status IN('queued','running')
   AND (payload->>'asset_id'=p_asset::text OR payload->>'record_id' IN(SELECT ra.record_id::text FROM public.record_assets ra WHERE ra.asset_id=p_asset));
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.move_to_top(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_to_top(UUID) TO authenticated;

-- queue_ahead now counts books ahead across indexing and AI work, in claim order (moved first, then oldest).
CREATE OR REPLACE FUNCTION public.activity_overview()
RETURNS TABLE(asset_id UUID, work_id UUID, record_id UUID, title TEXT, byline TEXT, file_format TEXT, file_size BIGINT, added_at TIMESTAMPTZ,
  processing_state TEXT, processing_error TEXT, passage_index JSONB, embedding_index JSONB, index_job TEXT, queue_ahead INT, embed_job TEXT,
  pending_steps TEXT[], failed_steps TEXT[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH files AS (
    SELECT DISTINCT ON (a.id) a.id, a.file_format, a.file_size, a.created_at, a.processing_state, a.processing_error, a.metadata, r.id record_id, w.id work_id,
      coalesce(r.title, w.title) title,
      (SELECT string_agg(coalesce(rc.credited_as, c.display_name), ', ' ORDER BY rc.position) FROM public.record_contributors rc JOIN public.contributors c ON c.id = rc.contributor_id
        WHERE rc.record_id = r.id AND rc.role = 'author') byline
    FROM public.assets a JOIN public.record_assets ra ON ra.asset_id = a.id AND ra.role = 'primary' JOIN public.records r ON r.id = ra.record_id JOIN public.works w ON w.id = r.work_id
    WHERE a.user_id = (SELECT auth.uid()) AND a.deleting_at IS NULL
    ORDER BY a.id, r.created_at, r.id),
  queue AS (
    SELECT g.asset, (count(*) OVER (ORDER BY g.moved DESC NULLS LAST, g.first_at, g.asset ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING))::int ahead
    FROM (SELECT j.payload->>'asset_id' asset, max(j.prioritized_at) moved, min(j.created_at) first_at FROM public.jobs j
      WHERE j.job_type IN ('index_passages','embed_passages') AND j.status IN ('queued','running') GROUP BY 1) g),
  steps AS (
    SELECT coalesce(j.payload->>'asset_id', (SELECT ra.asset_id::text FROM public.record_assets ra WHERE ra.record_id::text = j.payload->>'record_id' AND ra.role = 'primary' LIMIT 1)) asset,
      array_agg(DISTINCT j.job_type) FILTER (WHERE j.status IN ('queued','running')) pending,
      array_agg(DISTINCT j.job_type) FILTER (WHERE j.status = 'failed') failed
    FROM public.jobs j WHERE j.job_type IN ('extract_text','fetch_metadata','process_cover','extract_metadata_ai')
    GROUP BY 1)
  SELECT f.id, f.work_id, f.record_id, f.title, f.byline, f.file_format, f.file_size, f.created_at, f.processing_state, f.processing_error,
    f.metadata->'passage_index', f.metadata->'embedding_index',
    (SELECT i.status FROM public.jobs i WHERE i.job_type = 'index_passages' AND i.payload->>'asset_id' = f.id::text AND i.status IN ('queued','running') LIMIT 1),
    q.ahead,
    (SELECT e.status FROM public.jobs e WHERE e.job_type = 'embed_passages' AND e.payload->>'asset_id' = f.id::text AND e.status IN ('queued','running') LIMIT 1),
    coalesce(s.pending, '{}'), coalesce(s.failed, '{}')
  FROM files f LEFT JOIN queue q ON q.asset = f.id::text LEFT JOIN steps s ON s.asset = f.id::text
  ORDER BY f.created_at DESC, f.id
$$;
