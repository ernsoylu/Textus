-- Skip completed/failed version keys so an earlier file cannot starve later embedding work.
CREATE OR REPLACE FUNCTION public.queue_embedding_jobs(p_digest TEXT) RETURNS INT LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a RECORD; n INT=0;
BEGIN
 IF p_digest !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid model digest'; END IF;
 FOR a IN SELECT x.id,x.user_id,x.metadata->'passage_index'->>'version' AS version FROM public.assets x
 WHERE x.deleting_at IS NULL AND x.metadata->'passage_index'->>'status' IN('complete','partial')
 AND EXISTS(SELECT 1 FROM public.asset_passages p WHERE p.asset_id=x.id AND p.index_version=x.metadata->'passage_index'->>'version' AND p.embedding_digest IS DISTINCT FROM p_digest)
 AND NOT EXISTS(SELECT 1 FROM public.jobs j WHERE j.user_id=x.user_id AND j.job_type='embed_passages' AND j.payload->>'asset_id'=x.id::text AND j.status IN('queued','running'))
 AND NOT EXISTS(SELECT 1 FROM public.jobs j WHERE j.idempotency_key='embed_passages:'||x.id||':'||(x.metadata->'passage_index'->>'version')||':'||p_digest)
 ORDER BY x.created_at,x.id LIMIT 20 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(a.user_id::text||':index',0));
  IF (SELECT count(*) FROM public.jobs WHERE user_id=a.user_id AND status IN('queued','running'))<500 THEN
   INSERT INTO public.jobs(user_id,job_type,payload,idempotency_key) VALUES(a.user_id,'embed_passages',jsonb_build_object('asset_id',a.id,'index_version',a.version,'digest',p_digest),'embed_passages:'||a.id||':'||a.version||':'||p_digest) ON CONFLICT(idempotency_key) DO NOTHING;
   IF FOUND THEN n=n+1; END IF;
  END IF;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.queue_embedding_jobs(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_embedding_jobs(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.commit_embedding_batch(p_job UUID,p_generation BIGINT,p_vectors JSONB) RETURNS BOOLEAN LANGUAGE plpgsql SET search_path='' AS $$
DECLARE j public.jobs; a public.assets; owner_id UUID; remaining BOOLEAN;
BEGIN
 SELECT user_id INTO owner_id FROM public.jobs WHERE id=p_job;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||':index',0));
 SELECT * INTO j FROM public.jobs WHERE id=p_job AND status='running' AND claim_generation=p_generation AND lease_expires_at>now() FOR UPDATE;
 IF j.id IS NULL OR j.job_type<>'embed_passages' THEN RETURN false; END IF;
 SELECT * INTO a FROM public.assets WHERE id=(j.payload->>'asset_id')::uuid AND user_id=j.user_id AND deleting_at IS NULL FOR UPDATE;
 IF a.id IS NULL OR a.metadata->'passage_index'->>'version' IS DISTINCT FROM j.payload->>'index_version' OR a.metadata->'passage_index'->>'status'='cancelled' THEN RETURN false; END IF;
 IF jsonb_array_length(p_vectors) NOT BETWEEN 1 AND 4 OR (SELECT count(DISTINCT x.id) FROM jsonb_to_recordset(p_vectors) x(id BIGINT))<>jsonb_array_length(p_vectors) OR EXISTS(SELECT 1 FROM jsonb_to_recordset(p_vectors) x(id BIGINT) WHERE NOT EXISTS(SELECT 1 FROM public.asset_passages p WHERE p.id=x.id AND p.asset_id=a.id AND p.user_id=j.user_id AND p.index_version=j.payload->>'index_version')) THEN RAISE EXCEPTION 'invalid embedding batch'; END IF;
 UPDATE public.asset_passages p SET embedding=x.embedding::extensions.vector(768),embedding_digest=j.payload->>'digest'
 FROM jsonb_to_recordset(p_vectors) x(id BIGINT,embedding TEXT)
 WHERE p.id=x.id AND p.asset_id=a.id AND p.user_id=j.user_id AND p.index_version=j.payload->>'index_version';
 IF NOT FOUND THEN RAISE EXCEPTION 'embedding batch contains no owned passages'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.asset_passages p WHERE p.asset_id=a.id AND p.index_version=j.payload->>'index_version' AND p.embedding_digest IS DISTINCT FROM j.payload->>'digest') INTO remaining;
 UPDATE public.assets SET metadata=jsonb_set(metadata,'{embedding_index}',jsonb_build_object('digest',j.payload->>'digest','status',CASE WHEN remaining THEN 'indexing' ELSE 'complete' END)) WHERE id=a.id;
 RETURN public.finish_job(j.id,j.claim_generation,jsonb_build_object('remaining',remaining),NULL,CASE WHEN remaining THEN j.payload ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.commit_embedding_batch(UUID,BIGINT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_embedding_batch(UUID,BIGINT,JSONB) TO service_role;

