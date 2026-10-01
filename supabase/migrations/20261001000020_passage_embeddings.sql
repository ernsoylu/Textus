CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
ALTER TABLE public.asset_passages ADD COLUMN embedding extensions.vector(768),ADD COLUMN embedding_digest TEXT;
ALTER TABLE public.asset_passages ADD CONSTRAINT passage_embedding_pair CHECK((embedding IS NULL)=(embedding_digest IS NULL));

CREATE FUNCTION public.queue_embedding_jobs(p_digest TEXT) RETURNS INT LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a RECORD; n INT=0;
BEGIN
 IF p_digest !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid model digest'; END IF;
 FOR a IN SELECT x.id,x.user_id,x.metadata->'passage_index'->>'version' AS version FROM public.assets x
 WHERE x.deleting_at IS NULL AND x.metadata->'passage_index'->>'status' IN('complete','partial')
 AND EXISTS(SELECT 1 FROM public.asset_passages p WHERE p.asset_id=x.id AND p.index_version=x.metadata->'passage_index'->>'version' AND p.embedding_digest IS DISTINCT FROM p_digest)
 AND NOT EXISTS(SELECT 1 FROM public.jobs j WHERE j.user_id=x.user_id AND j.job_type='embed_passages' AND j.payload->>'asset_id'=x.id::text AND j.status IN('queued','running'))
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

CREATE FUNCTION public.commit_embedding_batch(p_job UUID,p_generation BIGINT,p_vectors JSONB) RETURNS BOOLEAN LANGUAGE plpgsql SET search_path='' AS $$
DECLARE j public.jobs; a public.assets; owner_id UUID; remaining BOOLEAN;
BEGIN
 SELECT user_id INTO owner_id FROM public.jobs WHERE id=p_job;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||':index',0));
 SELECT * INTO j FROM public.jobs WHERE id=p_job AND status='running' AND claim_generation=p_generation AND lease_expires_at>now() FOR UPDATE;
 IF j.id IS NULL OR j.job_type<>'embed_passages' THEN RETURN false; END IF;
 SELECT * INTO a FROM public.assets WHERE id=(j.payload->>'asset_id')::uuid AND user_id=j.user_id AND deleting_at IS NULL FOR UPDATE;
 IF a.id IS NULL OR a.metadata->'passage_index'->>'version' IS DISTINCT FROM j.payload->>'index_version' OR a.metadata->'passage_index'->>'status'='cancelled' THEN RETURN false; END IF;
 IF jsonb_array_length(p_vectors) NOT BETWEEN 1 AND 4 THEN RAISE EXCEPTION 'invalid embedding batch'; END IF;
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

-- ponytail: exact filtered vectors at the 50k-owner passage ceiling; add ANN only after measured latency/recall warrants it.
CREATE FUNCTION public.hybrid_passages(p_query TEXT,p_embedding extensions.vector(768),p_digest TEXT,p_limit INT DEFAULT 20,p_work_ids UUID[] DEFAULT NULL)
RETURNS TABLE(id BIGINT,asset_id UUID,record_id UUID,work_id UUID,title TEXT,byline TEXT,year INT,page INT,page_label TEXT,section INT,cfi TEXT,content TEXT,score REAL)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH eligible AS MATERIALIZED(
 SELECT p.id,p.asset_id,p.page,p.page_label,p.section,p.cfi,p.content,p.embedding,p.embedding_digest,p.search_vector,l.record_id,l.work_id,l.title,l.byline,l.year
 FROM public.asset_passages p JOIN public.assets a ON a.id=p.asset_id
 JOIN LATERAL(SELECT r.id record_id,w.id work_id,coalesce(r.title,w.title) title,extract(year FROM r.publication_date)::int AS year,
 (SELECT string_agg(coalesce(rc.credited_as,c.display_name),', ' ORDER BY rc.position) FROM public.record_contributors rc JOIN public.contributors c ON c.id=rc.contributor_id WHERE rc.record_id=r.id AND rc.role='author') byline
 FROM public.record_assets ra JOIN public.records r ON r.id=ra.record_id JOIN public.works w ON w.id=r.work_id WHERE ra.asset_id=p.asset_id AND w.user_id=auth.uid() AND (p_work_ids IS NULL OR (cardinality(p_work_ids)<=100 AND w.id=ANY(p_work_ids))) ORDER BY r.created_at,r.id LIMIT 1) l ON true
 WHERE p.user_id=auth.uid() AND a.deleting_at IS NULL AND p.index_version=a.metadata->'passage_index'->>'version'),
 lexical AS(SELECT id,row_number() OVER(ORDER BY ts_rank_cd(search_vector,websearch_to_tsquery('simple',left(p_query,1000))) DESC,id) rank FROM eligible WHERE search_vector@@websearch_to_tsquery('simple',left(p_query,1000)) LIMIT 100),
 semantic AS(SELECT id,row_number() OVER(ORDER BY embedding OPERATOR(extensions.<=>) p_embedding,id) rank FROM eligible WHERE embedding_digest=p_digest AND embedding IS NOT NULL AND p_embedding IS NOT NULL ORDER BY embedding OPERATOR(extensions.<=>) p_embedding,id LIMIT 100),
 ranks AS(SELECT coalesce(l.id,s.id) id,(coalesce(1.0/(60+l.rank),0)+coalesce(1.0/(60+s.rank),0))::real score FROM lexical l FULL JOIN semantic s USING(id))
 SELECT e.id,e.asset_id,e.record_id,e.work_id,e.title,e.byline,e.year,e.page,e.page_label,e.section,e.cfi,e.content,r.score FROM ranks r JOIN eligible e USING(id) ORDER BY r.score DESC,e.id LIMIT greatest(1,least(p_limit,20))
$$;
REVOKE ALL ON FUNCTION public.hybrid_passages(TEXT,extensions.vector,TEXT,INT,UUID[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hybrid_passages(TEXT,extensions.vector,TEXT,INT,UUID[]) TO authenticated;
