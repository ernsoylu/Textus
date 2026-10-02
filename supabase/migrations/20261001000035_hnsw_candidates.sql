-- 20261001000034 joined eligibility into both ranked scans, so the planner sorted every vector instead of
-- using HNSW and tested every passage instead of using the GIN index (app102, 32k passages: ~300 ms).
-- Candidates now come from asset_passages alone; eligibility is checked on the candidates.
-- relaxed_order may return index candidates slightly out of order; nearest re-ranks them by exact distance.
-- pgvector defines hnsw.* only once its library is loaded; without this, CREATE FUNCTION ... SET
-- hnsw.iterative_scan is refused for non-superusers. At call time the vector argument loads it first.
SELECT '[1]'::extensions.vector;

CREATE OR REPLACE FUNCTION public.hybrid_passages(p_query TEXT,p_embedding extensions.vector(768),p_digest TEXT,p_limit INT DEFAULT 20,p_work_ids UUID[] DEFAULT NULL)
RETURNS TABLE(id BIGINT,asset_id UUID,record_id UUID,work_id UUID,title TEXT,byline TEXT,year INT,page INT,page_label TEXT,section INT,cfi TEXT,content TEXT,score REAL)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' SET hnsw.iterative_scan='relaxed_order' SET hnsw.ef_search='200' AS $$
 WITH query AS(SELECT websearch_to_tsquery('simple',left(p_query,1000)) tsq),
 matches AS MATERIALIZED(
  -- Same planner trap as the vector scan: joined eligibility made it test every passage of every file
  -- against the query instead of using the GIN index (295 ms at 32k passages).
  SELECT p.id,p.asset_id,p.index_version,ts_rank_cd(p.search_vector,query.tsq) relevance
  FROM public.asset_passages p CROSS JOIN query WHERE p.user_id=auth.uid() AND p.search_vector@@query.tsq),
 lexical AS(
  SELECT c.id,row_number() OVER(ORDER BY c.relevance DESC,c.id) rank
  FROM matches c JOIN public.assets a ON a.id=c.asset_id
  WHERE a.deleting_at IS NULL AND c.index_version=a.metadata->'passage_index'->>'version'
   AND EXISTS(SELECT 1 FROM public.record_assets ra JOIN public.records r ON r.id=ra.record_id JOIN public.works w ON w.id=r.work_id
     WHERE ra.asset_id=c.asset_id AND w.user_id=auth.uid() AND (p_work_ids IS NULL OR (cardinality(p_work_ids)<=100 AND w.id=ANY(p_work_ids))))
  ORDER BY rank LIMIT 100),
 candidates AS MATERIALIZED(
  -- Only filters on asset_passages itself keep the HNSW index driving the scan (an eligibility join or
  -- key array made the planner sort every vector). Eligibility is checked on 4x the needed candidates.
  -- ponytail: results underfill if most of the owner's nearest vectors belong to stale or deleting files.
  (SELECT p.id,p.asset_id,p.index_version,p.embedding OPERATOR(extensions.<=>) p_embedding distance FROM public.asset_passages p
   WHERE p_work_ids IS NULL AND p_embedding IS NOT NULL AND p.user_id=auth.uid() AND p.embedding IS NOT NULL AND p.embedding_digest=p_digest
   ORDER BY p.embedding OPERATOR(extensions.<=>) p_embedding LIMIT 400)
  UNION ALL
  -- Work-filtered searches cover few files; rank them exactly.
  (SELECT p.id,p.asset_id,p.index_version,p.embedding OPERATOR(extensions.<=>) p_embedding FROM public.asset_passages p
   WHERE p_work_ids IS NOT NULL AND cardinality(p_work_ids)<=100 AND p_embedding IS NOT NULL AND p.user_id=auth.uid() AND p.embedding IS NOT NULL AND p.embedding_digest=p_digest
    AND p.asset_id IN(SELECT ra.asset_id FROM public.record_assets ra JOIN public.records r ON r.id=ra.record_id WHERE r.work_id=ANY(p_work_ids))
   ORDER BY p.embedding OPERATOR(extensions.<=>) p_embedding LIMIT 100)),
 nearest AS(
  SELECT c.id,c.distance FROM candidates c JOIN public.assets a ON a.id=c.asset_id
  WHERE a.deleting_at IS NULL AND c.index_version=a.metadata->'passage_index'->>'version'
   AND EXISTS(SELECT 1 FROM public.record_assets ra JOIN public.records r ON r.id=ra.record_id JOIN public.works w ON w.id=r.work_id
     WHERE ra.asset_id=c.asset_id AND w.user_id=auth.uid() AND (p_work_ids IS NULL OR (cardinality(p_work_ids)<=100 AND w.id=ANY(p_work_ids))))
  ORDER BY c.distance,c.id LIMIT 100),
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
