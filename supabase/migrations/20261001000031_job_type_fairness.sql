-- Same-priority job types take turns. Passage indexing re-queues its own job after every batch and
-- keeps the original created_at, so oldest-first starved embedding until the whole library was
-- indexed. Ordering by the type's latest start alternates indexing and embedding batches.
CREATE OR REPLACE FUNCTION public.claim_jobs(p_limit INT DEFAULT 1,p_lease INTERVAL DEFAULT interval '70 seconds')
RETURNS SETOF public.jobs LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_job public.jobs;
BEGIN
  SELECT j.* INTO v_job FROM public.jobs j WHERE j.attempts<j.max_attempts AND j.available_at<=now()
    AND (j.status='queued' OR (j.status='running' AND j.lease_expires_at<now()))
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

CREATE OR REPLACE FUNCTION public.control_passage_index(p_action TEXT,p_asset UUID DEFAULT NULL) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.assets; j public.jobs; n INT=0;
BEGIN
 IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'textus_agent','false')='true' THEN RAISE EXCEPTION 'owner session required' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN('backfill','reindex','retry','cancel') OR (p_action<>'backfill' AND p_asset IS NULL) THEN RAISE EXCEPTION 'invalid action'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':index',0));
 PERFORM 1 FROM public.jobs WHERE user_id=auth.uid() AND job_type IN('index_passages','embed_passages') AND (p_asset IS NULL OR payload->>'asset_id'=p_asset::text) ORDER BY id FOR UPDATE;
 FOR a IN SELECT x.* FROM public.assets x WHERE x.user_id=auth.uid() AND x.deleting_at IS NULL AND x.file_format IN('pdf','epub') AND (p_asset IS NULL OR x.id=p_asset)
  AND (p_action<>'backfill' OR x.metadata->'passage_index' IS NULL) ORDER BY x.created_at LIMIT 100 FOR UPDATE
 LOOP
  IF p_action='cancel' THEN
   UPDATE public.jobs SET status='cancelled',claim_generation=claim_generation+1,lease_expires_at=NULL WHERE user_id=auth.uid() AND job_type IN('index_passages','embed_passages') AND payload->>'asset_id'=a.id::text AND status IN('queued','running');
   UPDATE public.assets SET metadata=jsonb_set(metadata,'{passage_index,status}','"cancelled"') WHERE id=a.id AND metadata->'passage_index' IS NOT NULL;
   n=n+1;
  ELSIF p_action='retry' THEN
   SELECT * INTO j FROM public.jobs WHERE user_id=auth.uid() AND job_type='index_passages' AND payload->>'asset_id'=a.id::text AND payload->>'index_version'=a.metadata->'passage_index'->>'version' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
   IF j.status IN('failed','cancelled') THEN
    UPDATE public.jobs SET status='queued',attempts=0,claim_generation=claim_generation+1,available_at=now(),lease_expires_at=NULL,last_error=NULL WHERE id=j.id;
    -- The failure trigger's message is not a parser limit; left in place, it would mark a complete retry partial.
    UPDATE public.assets SET metadata=CASE WHEN metadata->'passage_index'->>'reason'='Indexing failed. Retry continues from the last checkpoint.'
      THEN jsonb_set(metadata,'{passage_index,status}','"queued"') #- '{passage_index,reason}' ELSE jsonb_set(metadata,'{passage_index,status}','"queued"') END WHERE id=a.id;
    n=n+1;
   END IF;
  ELSIF private.queue_passage_index(a.id,auth.uid()) THEN n=n+1;
  END IF;
 END LOOP;
 RETURN n;
END $$;
