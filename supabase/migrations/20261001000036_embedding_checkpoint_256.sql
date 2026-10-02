-- Re-embedding the library with a new model is ~49k passages; at 64 per checkpoint, scheduling rather than
-- the GPU limited throughput. A run still stops at half its time budget, so this only lets fast runs do more.
CREATE OR REPLACE FUNCTION public.commit_embedding_batch(p_job UUID,p_generation BIGINT,p_vectors JSONB) RETURNS BOOLEAN LANGUAGE plpgsql SET search_path='' AS $$
DECLARE j public.jobs; a public.assets; owner_id UUID; remaining BOOLEAN;
BEGIN
 SELECT user_id INTO owner_id FROM public.jobs WHERE id=p_job;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||':index',0));
 SELECT * INTO j FROM public.jobs WHERE id=p_job AND status='running' AND claim_generation=p_generation AND lease_expires_at>now() FOR UPDATE;
 IF j.id IS NULL OR j.job_type<>'embed_passages' THEN RETURN false; END IF;
 SELECT * INTO a FROM public.assets WHERE id=(j.payload->>'asset_id')::uuid AND user_id=j.user_id AND deleting_at IS NULL FOR UPDATE;
 IF a.id IS NULL OR a.metadata->'passage_index'->>'version' IS DISTINCT FROM j.payload->>'index_version' OR a.metadata->'passage_index'->>'status'='cancelled' THEN RETURN false; END IF;
 IF jsonb_array_length(p_vectors) NOT BETWEEN 1 AND 256 OR (SELECT count(DISTINCT x.id) FROM jsonb_to_recordset(p_vectors) x(id BIGINT))<>jsonb_array_length(p_vectors) OR EXISTS(SELECT 1 FROM jsonb_to_recordset(p_vectors) x(id BIGINT) WHERE NOT EXISTS(SELECT 1 FROM public.asset_passages p WHERE p.id=x.id AND p.asset_id=a.id AND p.user_id=j.user_id AND p.index_version=j.payload->>'index_version')) THEN RAISE EXCEPTION 'invalid embedding batch'; END IF;
 UPDATE public.asset_passages p SET embedding=x.embedding::extensions.vector(768),embedding_digest=j.payload->>'digest'
 FROM jsonb_to_recordset(p_vectors) x(id BIGINT,embedding TEXT)
 WHERE p.id=x.id AND p.asset_id=a.id AND p.user_id=j.user_id AND p.index_version=j.payload->>'index_version';
 IF NOT FOUND THEN RAISE EXCEPTION 'embedding batch contains no owned passages'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.asset_passages p WHERE p.asset_id=a.id AND p.index_version=j.payload->>'index_version' AND p.embedding_digest IS DISTINCT FROM j.payload->>'digest') INTO remaining;
 UPDATE public.assets SET metadata=jsonb_set(metadata,'{embedding_index}',jsonb_build_object('digest',j.payload->>'digest','status',CASE WHEN remaining THEN 'indexing' ELSE 'complete' END)) WHERE id=a.id;
 RETURN public.finish_job(j.id,j.claim_generation,jsonb_build_object('remaining',remaining),NULL,CASE WHEN remaining THEN j.payload ELSE NULL END);
END $$;
