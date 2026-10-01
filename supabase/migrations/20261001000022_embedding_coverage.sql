CREATE FUNCTION public.passage_embedding_coverage(p_digest TEXT,p_work_ids UUID[] DEFAULT NULL) RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('totalPassages',count(*),'embeddedPassages',count(*) FILTER(WHERE p.embedding_digest=p_digest),'partial',coalesce(bool_or(p.embedding_digest IS DISTINCT FROM p_digest),false))
 FROM public.asset_passages p JOIN public.assets a ON a.id=p.asset_id
 WHERE p.user_id=auth.uid() AND a.deleting_at IS NULL AND p.index_version=a.metadata->'passage_index'->>'version'
 AND EXISTS(SELECT 1 FROM public.record_assets ra JOIN public.records r ON r.id=ra.record_id JOIN public.works w ON w.id=r.work_id WHERE ra.asset_id=p.asset_id AND w.user_id=auth.uid() AND (p_work_ids IS NULL OR (cardinality(p_work_ids)<=100 AND w.id=ANY(p_work_ids))))
$$;
REVOKE ALL ON FUNCTION public.passage_embedding_coverage(TEXT,UUID[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.passage_embedding_coverage(TEXT,UUID[]) TO authenticated;
