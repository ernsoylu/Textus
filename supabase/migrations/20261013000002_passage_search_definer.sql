-- SECURITY DEFINER, deliberately, as search_library (ARCHITECTURE §14 #23): under SECURITY INVOKER, RLS on
-- asset_passages keeps the non-leakproof @@ out of the index condition, so every passage's search_vector was
-- detoasted. On app102 (491k passages) 'second law' took 1.7 s as a seq scan vs 28 ms on the GIN index, and MCP
-- search_passages / find_sources hit the 8 s statement_timeout. Both bodies scope every leg to the caller:
-- passages by p.user_id=auth.uid(), and records, credits and the work filter through works.user_id=auth.uid().
-- search_path is empty; execute stays revoked from PUBLIC and anon.
ALTER FUNCTION public.hybrid_passages(TEXT,extensions.vector,TEXT,INT,UUID[]) SECURITY DEFINER;

-- search_passages also had hybrid_passages' old planner traps (20261001000035): the eligibility join made it test
-- every passage, and title/byline were looked up for every hit before the limit. It now matches hybrid's lexical leg.
-- ponytail: ranking is still O(hits); a broad any-term query over a whole library takes ~1.5 s on app102.
CREATE OR REPLACE FUNCTION public.search_passages(p_query TEXT,p_limit INT DEFAULT 20,p_work_ids UUID[] DEFAULT NULL)
RETURNS TABLE(id BIGINT,asset_id UUID,record_id UUID,work_id UUID,title TEXT,byline TEXT,year INT,page INT,page_label TEXT,section INT,cfi TEXT,content TEXT,score REAL)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH query AS(SELECT websearch_to_tsquery('simple',left(p_query,1000)) tsq),
 matches AS MATERIALIZED(
  SELECT p.id,p.asset_id,p.index_version,ts_rank_cd(p.search_vector,query.tsq) relevance
  FROM public.asset_passages p CROSS JOIN query WHERE p.user_id=auth.uid() AND p.search_vector@@query.tsq),
 top AS(
  SELECT c.id,c.relevance FROM matches c JOIN public.assets a ON a.id=c.asset_id
  WHERE a.deleting_at IS NULL AND c.index_version=a.metadata->'passage_index'->>'version'
   AND EXISTS(SELECT 1 FROM public.record_assets ra JOIN public.records r ON r.id=ra.record_id JOIN public.works w ON w.id=r.work_id
     WHERE ra.asset_id=c.asset_id AND w.user_id=auth.uid() AND (p_work_ids IS NULL OR (cardinality(p_work_ids)<=100 AND w.id=ANY(p_work_ids))))
  ORDER BY c.relevance DESC,c.id LIMIT greatest(1,least(p_limit,20)))
 SELECT p.id,p.asset_id,l.record_id,l.work_id,l.title,l.byline,l.year,p.page,p.page_label,p.section,p.cfi,p.content,t.relevance
 FROM top t JOIN public.asset_passages p ON p.id=t.id
 JOIN LATERAL(SELECT r.id record_id,w.id work_id,coalesce(r.title,w.title) title,extract(year FROM r.publication_date)::int AS year,
  (SELECT string_agg(coalesce(rc.credited_as,c.display_name),', ' ORDER BY rc.position) FROM public.record_contributors rc JOIN public.contributors c ON c.id=rc.contributor_id WHERE rc.record_id=r.id AND rc.role='author') byline
  FROM public.record_assets ra JOIN public.records r ON r.id=ra.record_id JOIN public.works w ON w.id=r.work_id WHERE ra.asset_id=p.asset_id AND w.user_id=auth.uid() AND (p_work_ids IS NULL OR (cardinality(p_work_ids)<=100 AND w.id=ANY(p_work_ids))) ORDER BY r.created_at,r.id LIMIT 1) l ON true
 ORDER BY t.relevance DESC,p.id
$$;
