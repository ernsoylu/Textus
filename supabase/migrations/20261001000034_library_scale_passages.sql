-- Indexing a whole library needs ~85-90k passages for one owner, beyond the 50,000 ceiling, and a single
-- EPUB content document can exceed 128 passages. The ceiling rises to 250,000 per owner and 1,024 per batch.
CREATE OR REPLACE FUNCTION public.commit_passage_batch(p_job UUID,p_generation BIGINT,p_passages JSONB,p_done INT,p_total INT,p_status TEXT DEFAULT 'indexing',p_reason TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SET search_path='' AS $$
DECLARE j public.jobs; a public.assets; v_count INT; v_state JSONB;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=p_job;
 IF j.id IS NULL THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(j.user_id::text||':index',0));
 SELECT * INTO j FROM public.jobs WHERE id=p_job AND status='running' AND claim_generation=p_generation AND lease_expires_at>now() FOR UPDATE;
 IF j.id IS NULL OR j.job_type<>'index_passages' THEN RETURN false; END IF;
 SELECT * INTO a FROM public.assets WHERE id=(j.payload->>'asset_id')::uuid AND user_id=j.user_id AND deleting_at IS NULL FOR UPDATE;
 IF a.id IS NULL OR a.metadata->'passage_index'->>'version' IS DISTINCT FROM j.payload->>'index_version' THEN RETURN false; END IF;
 IF jsonb_array_length(p_passages)>1024 OR p_done<coalesce((a.metadata->'passage_index'->>'done')::int,0) OR p_done>p_total OR p_total>100000 OR p_status NOT IN('indexing','complete','no_text','not_indexable','partial') THEN RAISE EXCEPTION 'invalid checkpoint'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(j.user_id::text||':index',0));
 IF (SELECT count(*) FROM public.asset_passages WHERE user_id=j.user_id)+jsonb_array_length(p_passages)>250000 THEN RAISE EXCEPTION 'passage quota exceeded' USING ERRCODE='53300'; END IF;
 INSERT INTO public.asset_passages(asset_id,user_id,index_version,ordinal,page,page_label,section,cfi,content)
 SELECT a.id,j.user_id,j.payload->>'index_version',x.ordinal,x.page,x.page_label,x.section,x.cfi,x.content FROM jsonb_to_recordset(p_passages) AS x(ordinal INT,page INT,page_label TEXT,section INT,cfi TEXT,content TEXT)
 ON CONFLICT(asset_id,index_version,ordinal) DO NOTHING;
 SELECT count(*)::int INTO v_count FROM public.asset_passages WHERE asset_id=a.id AND index_version=j.payload->>'index_version';
 v_state=jsonb_build_object('version',j.payload->>'index_version','status',p_status,'done',p_done,'total',p_total,'passages',v_count,'reason',p_reason);
 UPDATE public.assets SET metadata=jsonb_set(coalesce(metadata,'{}'),'{passage_index}',v_state) WHERE id=a.id;
 -- Checkpoint and continuation are one transaction, including cancellation/generation checks.
 RETURN public.finish_job(j.id,j.claim_generation,v_state,NULL,CASE WHEN p_status='indexing' THEN j.payload||jsonb_build_object('from',p_done,'ordinal',v_count) ELSE NULL END);
END $$;

-- hybrid_passages() materialized every eligible passage (with per-passage title/byline lookups) before
-- ranking, so its cost grew with the library and no index could serve it. Lexical and semantic candidates
-- are now ranked straight from asset_passages: the semantic scan uses HNSW with pgvector's iterative scan,
-- so ownership/version/work filters are applied during the index scan instead of truncating its results.
-- Bibliographic metadata is looked up for the final results only.
CREATE INDEX asset_passages_embedding_hnsw ON public.asset_passages USING hnsw (embedding extensions.vector_cosine_ops) WHERE embedding IS NOT NULL;

CREATE OR REPLACE FUNCTION public.hybrid_passages(p_query TEXT,p_embedding extensions.vector(768),p_digest TEXT,p_limit INT DEFAULT 20,p_work_ids UUID[] DEFAULT NULL)
RETURNS TABLE(id BIGINT,asset_id UUID,record_id UUID,work_id UUID,title TEXT,byline TEXT,year INT,page INT,page_label TEXT,section INT,cfi TEXT,content TEXT,score REAL)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' SET hnsw.iterative_scan='relaxed_order' SET hnsw.ef_search='200' AS $$
 WITH query AS(SELECT websearch_to_tsquery('simple',left(p_query,1000)) tsq),
 lexical AS(
  SELECT p.id,row_number() OVER(ORDER BY ts_rank_cd(p.search_vector,query.tsq) DESC,p.id) rank
  FROM public.asset_passages p JOIN public.assets a ON a.id=p.asset_id CROSS JOIN query
  WHERE p.user_id=auth.uid() AND p.search_vector@@query.tsq AND a.deleting_at IS NULL AND p.index_version=a.metadata->'passage_index'->>'version'
   AND EXISTS(SELECT 1 FROM public.record_assets ra JOIN public.records r ON r.id=ra.record_id JOIN public.works w ON w.id=r.work_id
     WHERE ra.asset_id=p.asset_id AND w.user_id=auth.uid() AND (p_work_ids IS NULL OR (cardinality(p_work_ids)<=100 AND w.id=ANY(p_work_ids))))
  ORDER BY rank LIMIT 100),
 nearest AS(
  -- relaxed_order may return index candidates slightly out of order; they are re-ranked by exact distance below.
  SELECT p.id,p.embedding OPERATOR(extensions.<=>) p_embedding distance
  FROM public.asset_passages p JOIN public.assets a ON a.id=p.asset_id
  WHERE p_embedding IS NOT NULL AND p.user_id=auth.uid() AND p.embedding IS NOT NULL AND p.embedding_digest=p_digest
   AND a.deleting_at IS NULL AND p.index_version=a.metadata->'passage_index'->>'version'
   AND EXISTS(SELECT 1 FROM public.record_assets ra JOIN public.records r ON r.id=ra.record_id JOIN public.works w ON w.id=r.work_id
     WHERE ra.asset_id=p.asset_id AND w.user_id=auth.uid() AND (p_work_ids IS NULL OR (cardinality(p_work_ids)<=100 AND w.id=ANY(p_work_ids))))
  ORDER BY p.embedding OPERATOR(extensions.<=>) p_embedding LIMIT 100),
 semantic AS(SELECT id,row_number() OVER(ORDER BY distance,id) rank FROM nearest),
 ranks AS(SELECT coalesce(l.id,s.id) id,(coalesce(1.0/(60+l.rank),0)+coalesce(1.0/(60+s.rank),0))::real score FROM lexical l FULL JOIN semantic s USING(id)),
 top AS(SELECT r.id,r.score FROM ranks r ORDER BY r.score DESC,r.id LIMIT greatest(1,least(p_limit,20)))
 SELECT p.id,p.asset_id,l.record_id,l.work_id,l.title,l.byline,l.year,p.page,p.page_label,p.section,p.cfi,p.content,t.score
 FROM top t JOIN public.asset_passages p ON p.id=t.id
 JOIN LATERAL(SELECT r.id record_id,w.id work_id,coalesce(r.title,w.title) title,extract(year FROM r.publication_date)::int AS year,
  (SELECT string_agg(coalesce(rc.credited_as,c.display_name),', ' ORDER BY rc.position) FROM public.record_contributors rc JOIN public.contributors c ON c.id=rc.contributor_id WHERE rc.record_id=r.id AND rc.role='author') byline
  FROM public.record_assets ra JOIN public.records r ON r.id=ra.record_id JOIN public.works w ON w.id=r.work_id WHERE ra.asset_id=p.asset_id AND w.user_id=auth.uid() AND (p_work_ids IS NULL OR (cardinality(p_work_ids)<=100 AND w.id=ANY(p_work_ids))) ORDER BY r.created_at,r.id LIMIT 1) l ON true
 ORDER BY t.score DESC,p.id
$$;
REVOKE ALL ON FUNCTION public.hybrid_passages(TEXT,extensions.vector,TEXT,INT,UUID[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hybrid_passages(TEXT,extensions.vector,TEXT,INT,UUID[]) TO authenticated;
