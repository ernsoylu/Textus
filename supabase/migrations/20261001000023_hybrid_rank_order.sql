-- Make lexical top-k ordering explicit rather than relying on the window executor order.
CREATE OR REPLACE FUNCTION public.hybrid_passages(p_query TEXT,p_embedding extensions.vector(768),p_digest TEXT,p_limit INT DEFAULT 20,p_work_ids UUID[] DEFAULT NULL)
RETURNS TABLE(id BIGINT,asset_id UUID,record_id UUID,work_id UUID,title TEXT,byline TEXT,year INT,page INT,page_label TEXT,section INT,cfi TEXT,content TEXT,score REAL)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH eligible AS MATERIALIZED(
 SELECT p.id,p.asset_id,p.page,p.page_label,p.section,p.cfi,p.content,p.embedding,p.embedding_digest,p.search_vector,l.record_id,l.work_id,l.title,l.byline,l.year
 FROM public.asset_passages p JOIN public.assets a ON a.id=p.asset_id
 JOIN LATERAL(SELECT r.id record_id,w.id work_id,coalesce(r.title,w.title) title,extract(year FROM r.publication_date)::int AS year,
 (SELECT string_agg(coalesce(rc.credited_as,c.display_name),', ' ORDER BY rc.position) FROM public.record_contributors rc JOIN public.contributors c ON c.id=rc.contributor_id WHERE rc.record_id=r.id AND rc.role='author') byline
 FROM public.record_assets ra JOIN public.records r ON r.id=ra.record_id JOIN public.works w ON w.id=r.work_id WHERE ra.asset_id=p.asset_id AND w.user_id=auth.uid() AND (p_work_ids IS NULL OR (cardinality(p_work_ids)<=100 AND w.id=ANY(p_work_ids))) ORDER BY r.created_at,r.id LIMIT 1) l ON true
 WHERE p.user_id=auth.uid() AND a.deleting_at IS NULL AND p.index_version=a.metadata->'passage_index'->>'version'),
 lexical AS(SELECT id,row_number() OVER(ORDER BY ts_rank_cd(search_vector,websearch_to_tsquery('simple',left(p_query,1000))) DESC,id) rank FROM eligible WHERE search_vector@@websearch_to_tsquery('simple',left(p_query,1000)) ORDER BY rank,id LIMIT 100),
 semantic AS(SELECT id,row_number() OVER(ORDER BY embedding OPERATOR(extensions.<=>) p_embedding,id) rank FROM eligible WHERE embedding_digest=p_digest AND embedding IS NOT NULL AND p_embedding IS NOT NULL ORDER BY embedding OPERATOR(extensions.<=>) p_embedding,id LIMIT 100),
 ranks AS(SELECT coalesce(l.id,s.id) id,(coalesce(1.0/(60+l.rank),0)+coalesce(1.0/(60+s.rank),0))::real score FROM lexical l FULL JOIN semantic s USING(id))
 SELECT e.id,e.asset_id,e.record_id,e.work_id,e.title,e.byline,e.year,e.page,e.page_label,e.section,e.cfi,e.content,r.score FROM ranks r JOIN eligible e USING(id) ORDER BY r.score DESC,e.id LIMIT greatest(1,least(p_limit,20))
$$;
REVOKE ALL ON FUNCTION public.hybrid_passages(TEXT,extensions.vector,TEXT,INT,UUID[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hybrid_passages(TEXT,extensions.vector,TEXT,INT,UUID[]) TO authenticated;
