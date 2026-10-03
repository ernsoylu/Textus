-- Automatic extraction scheduling must not restart an already indexed/reindexed asset.
CREATE OR REPLACE FUNCTION public.queue_passage_index(p_asset UUID,p_owner UUID) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text||':index',0));
 PERFORM 1 FROM public.jobs WHERE user_id=p_owner AND job_type IN('index_passages','embed_passages') AND payload->>'asset_id'=p_asset::text ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.assets WHERE id=p_asset AND user_id=p_owner AND metadata->'passage_index' IS NOT NULL) THEN RETURN false; END IF;
 -- Queue pressure must not turn successfully read files into extraction failures.
 IF (SELECT count(*) FROM public.jobs WHERE user_id=p_owner AND status IN('queued','running'))>=500 THEN RETURN false; END IF;
 RETURN private.queue_passage_index(p_asset,p_owner);
END $$;

-- Activity retries the failed read job without discarding existing passage checkpoints.
CREATE OR REPLACE FUNCTION public.control_passage_index(p_action TEXT,p_asset UUID DEFAULT NULL) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.assets; j public.jobs; n INT=0;
BEGIN
 IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'textus_agent','false')='true' THEN RAISE EXCEPTION 'owner session required' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN('backfill','reindex','retry','cancel') OR (p_action<>'backfill' AND p_asset IS NULL) THEN RAISE EXCEPTION 'invalid action'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':index',0));
 PERFORM 1 FROM public.jobs WHERE user_id=auth.uid() AND job_type IN('extract_text','index_passages','embed_passages') AND (p_asset IS NULL OR payload->>'asset_id'=p_asset::text) ORDER BY id FOR UPDATE;
 FOR a IN SELECT x.* FROM public.assets x WHERE x.user_id=auth.uid() AND x.deleting_at IS NULL AND (x.file_format IN('pdf','epub') OR p_action='retry') AND (p_asset IS NULL OR x.id=p_asset)
  AND (p_action<>'backfill' OR x.metadata->'passage_index' IS NULL) ORDER BY x.created_at LIMIT 100 FOR UPDATE
 LOOP
  IF p_action='cancel' THEN
   UPDATE public.jobs SET status='cancelled',claim_generation=claim_generation+1,lease_expires_at=NULL WHERE user_id=auth.uid() AND job_type IN('index_passages','embed_passages') AND payload->>'asset_id'=a.id::text AND status IN('queued','running');
   UPDATE public.assets SET metadata=jsonb_set(metadata,'{passage_index,status}','"cancelled"') WHERE id=a.id AND metadata->'passage_index' IS NOT NULL;
   n=n+1;
  ELSIF p_action='retry' AND a.processing_state='failed' THEN
   SELECT * INTO j FROM public.jobs WHERE user_id=auth.uid() AND job_type='extract_text' AND payload->>'asset_id'=a.id::text AND status='failed' ORDER BY created_at DESC LIMIT 1;
   IF j.id IS NOT NULL THEN
    UPDATE public.jobs SET status='queued',attempts=0,claim_generation=claim_generation+1,available_at=now(),lease_expires_at=NULL,last_error=NULL,completed_at=NULL WHERE id=j.id;
    UPDATE public.assets SET processing_state='pending',processing_error=NULL WHERE id=a.id;
    n=n+1;
   END IF;
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
