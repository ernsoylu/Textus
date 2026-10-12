-- find_sources sends a question's terms as an any-term query. A term found in a large share of passages ("second" is
-- in 8% of app102's 491k) makes every lexical search rank tens of thousands of matches while adding little to which
-- passages are relevant. Pure OR queries now match only on their distinctive terms and still rank on every term:
-- dropping common terms from the ranking too let lone "balance" or "law" passages (Python loops, set algebra) outrank
-- the energy-balance and second-law ones. On app102, five questions: 0.4-1.8 s -> 0.2-0.46 s, top 10 unchanged for
-- three and 9/10 and 7/10 for the others, where the changes replaced off-topic "energy"/"system"/"second" matches.
-- Statistics come from ANALYZE (pg_stats). They are instance-wide and hidden from RLS-limited roles, so they are read
-- only by these SECURITY DEFINER functions, never exposed, and used only when the caller owns every file on the instance.
-- ponytail: multi-owner instances get no pruning; add per-owner term statistics if Textus is shared.
CREATE FUNCTION private.common_passage_terms(p_terms TEXT[],p_owner UUID) RETURNS TEXT[]
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(array_agg(DISTINCT x.term),'{}')
 FROM pg_catalog.pg_stats s, unnest(s.most_common_elems::text::text[],s.most_common_elem_freqs) AS x(term,freq)
 WHERE s.schemaname='public' AND s.tablename='asset_passages' AND s.attname='search_vector'
  AND x.freq>0.05 AND x.term=ANY(p_terms[1:50])
  AND p_owner IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.assets a WHERE a.user_id<>p_owner)
$$;
-- The query to match passages with: for a pure OR query, its terms minus common ones; otherwise the query itself.
CREATE FUNCTION private.passage_match_query(p_query tsquery,p_owner UUID) RETURNS tsquery
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH terms AS(SELECT array_agg(DISTINCT replace(m[1],'''''','''')) lexemes FROM regexp_matches(p_query::text,'''((?:[^'']|'''')*)''','g') m),
 rare AS(SELECT array(SELECT unnest(t.lexemes) EXCEPT SELECT unnest(private.common_passage_terms(t.lexemes,p_owner))) lexemes, t.lexemes all_lexemes FROM terms t)
 SELECT CASE WHEN regexp_replace(p_query::text,'''(?:[^'']|'''')*''','','g') ~ '[&!<]' OR cardinality(r.lexemes) IN (0, cardinality(r.all_lexemes))
   THEN p_query ELSE (SELECT string_agg(quote_literal(l),' | ') FROM unnest(r.lexemes) l)::tsquery END
 FROM rare r
$$;
REVOKE ALL ON FUNCTION private.common_passage_terms(TEXT[],UUID),private.passage_match_query(tsquery,UUID) FROM PUBLIC,anon,authenticated;
SELECT '[1]'::extensions.vector;

CREATE OR REPLACE FUNCTION public.search_passages(p_query TEXT,p_limit INT DEFAULT 20,p_work_ids UUID[] DEFAULT NULL)
RETURNS TABLE(id BIGINT,asset_id UUID,record_id UUID,work_id UUID,title TEXT,byline TEXT,year INT,page INT,page_label TEXT,section INT,cfi TEXT,content TEXT,score REAL)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH query AS(SELECT q.tsq,private.passage_match_query(q.tsq,auth.uid()) mtsq FROM (SELECT websearch_to_tsquery('simple',left(p_query,1000)) tsq) q),
 matches AS MATERIALIZED(
  SELECT p.id,p.asset_id,p.index_version,ts_rank_cd(p.search_vector,query.tsq) relevance
  FROM public.asset_passages p CROSS JOIN query WHERE p.user_id=auth.uid() AND p.search_vector@@query.mtsq),
 eligible AS MATERIALIZED(
  SELECT a.id,a.metadata->'passage_index'->>'version' version FROM public.assets a
  WHERE a.user_id=auth.uid() AND a.deleting_at IS NULL
   AND EXISTS(SELECT 1 FROM public.record_assets ra JOIN public.records r ON r.id=ra.record_id JOIN public.works w ON w.id=r.work_id
     WHERE ra.asset_id=a.id AND w.user_id=auth.uid() AND (p_work_ids IS NULL OR (cardinality(p_work_ids)<=100 AND w.id=ANY(p_work_ids))))),
 top AS(
  SELECT c.id,c.relevance FROM matches c JOIN eligible e ON e.id=c.asset_id AND e.version=c.index_version
  ORDER BY c.relevance DESC,c.id LIMIT greatest(1,least(p_limit,20)))
 SELECT p.id,p.asset_id,l.record_id,l.work_id,l.title,l.byline,l.year,p.page,p.page_label,p.section,p.cfi,p.content,t.relevance
 FROM top t JOIN public.asset_passages p ON p.id=t.id
 JOIN LATERAL(SELECT r.id record_id,w.id work_id,coalesce(r.title,w.title) title,extract(year FROM r.publication_date)::int AS year,
  (SELECT string_agg(coalesce(rc.credited_as,c.display_name),', ' ORDER BY rc.position) FROM public.record_contributors rc JOIN public.contributors c ON c.id=rc.contributor_id WHERE rc.record_id=r.id AND rc.role='author') byline
  FROM public.record_assets ra JOIN public.records r ON r.id=ra.record_id JOIN public.works w ON w.id=r.work_id WHERE ra.asset_id=p.asset_id AND w.user_id=auth.uid() AND (p_work_ids IS NULL OR (cardinality(p_work_ids)<=100 AND w.id=ANY(p_work_ids))) ORDER BY r.created_at,r.id LIMIT 1) l ON true
 ORDER BY t.relevance DESC,p.id
$$;

CREATE OR REPLACE FUNCTION public.hybrid_passages(p_query TEXT,p_embedding extensions.vector(768),p_digest TEXT,p_limit INT DEFAULT 20,p_work_ids UUID[] DEFAULT NULL)
RETURNS TABLE(id BIGINT,asset_id UUID,record_id UUID,work_id UUID,title TEXT,byline TEXT,year INT,page INT,page_label TEXT,section INT,cfi TEXT,content TEXT,score REAL)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' SET hnsw.iterative_scan='relaxed_order' SET hnsw.ef_search='200' AS $$
 WITH query AS(SELECT q.tsq,private.passage_match_query(q.tsq,auth.uid()) mtsq FROM (SELECT websearch_to_tsquery('simple',left(p_query,1000)) tsq) q),
 matches AS MATERIALIZED(
  -- Same planner trap as the vector scan: joined eligibility made it test every passage of every file
  -- against the query instead of using the GIN index (295 ms at 32k passages).
  SELECT p.id,p.asset_id,p.index_version,ts_rank_cd(p.search_vector,query.tsq) relevance
  FROM public.asset_passages p CROSS JOIN query WHERE p.user_id=auth.uid() AND p.search_vector@@query.mtsq),
 eligible AS MATERIALIZED(
  -- Files the caller may cite, with their live index version: checked once per file, then hash-joined.
  SELECT a.id,a.metadata->'passage_index'->>'version' version FROM public.assets a
  WHERE a.user_id=auth.uid() AND a.deleting_at IS NULL
   AND EXISTS(SELECT 1 FROM public.record_assets ra JOIN public.records r ON r.id=ra.record_id JOIN public.works w ON w.id=r.work_id
     WHERE ra.asset_id=a.id AND w.user_id=auth.uid() AND (p_work_ids IS NULL OR (cardinality(p_work_ids)<=100 AND w.id=ANY(p_work_ids))))),
 lexical AS(
  SELECT c.id,row_number() OVER(ORDER BY c.relevance DESC,c.id) rank
  FROM matches c JOIN eligible e ON e.id=c.asset_id AND e.version=c.index_version
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
  SELECT c.id,c.distance FROM candidates c JOIN eligible e ON e.id=c.asset_id AND e.version=c.index_version
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
