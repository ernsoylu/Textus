-- Partial, accent-insensitive Unicode metadata search alongside existing file-text search.
BEGIN;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE OR REPLACE FUNCTION public.search_library(p_query TEXT, p_limit INT DEFAULT 50)
RETURNS TABLE (work_id UUID, record_id UUID, title TEXT, rank REAL)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH me AS (SELECT (SELECT auth.uid()) AS uid),
    q AS (SELECT websearch_to_tsquery('english', p_query) AS tsq,
        '%' || replace(replace(replace(public.unaccent(normalize(btrim(p_query), NFC)), chr(92), chr(92)||chr(92)), '%', chr(92)||'%'), '_', chr(92)||'_') || '%' AS pattern),
    -- ponytail: folded substring scans owner catalog metadata; add folded GIN indexes
    -- if larger catalogs exceed the search latency budget. File text keeps its indexed FTS path.
    candidates AS (
        SELECT r.id AS record_id FROM public.works w JOIN public.records r ON r.work_id = w.id, q, me
        WHERE w.user_id = me.uid AND public.unaccent(normalize(concat_ws(' ', w.title, w.subtitle, w.abstract), NFC)) ILIKE q.pattern
        UNION
        SELECT r.id FROM public.records r JOIN public.works w ON w.id = r.work_id, q, me
        WHERE w.user_id = me.uid AND public.unaccent(normalize(concat_ws(' ', r.title, r.publisher, r.edition, r.volume, r.issue_number, r.pages, r.metadata->>'container_title'), NFC)) ILIKE q.pattern
        UNION
        SELECT rc.record_id FROM public.contributors c JOIN public.record_contributors rc ON rc.contributor_id = c.id, q, me
        WHERE c.user_id = me.uid AND public.unaccent(normalize(c.display_name, NFC)) ILIKE q.pattern
        UNION
        SELECT rc.record_id FROM public.contributor_names cn JOIN public.record_contributors rc ON rc.contributor_id = cn.contributor_id, q, me
        WHERE cn.user_id = me.uid AND public.unaccent(normalize(cn.name, NFC)) ILIKE q.pattern
        UNION
        SELECT rc.record_id FROM public.record_contributors rc JOIN public.records r ON r.id = rc.record_id JOIN public.works w ON w.id = r.work_id, q, me
        WHERE w.user_id = me.uid AND public.unaccent(normalize(rc.credited_as, NFC)) ILIKE q.pattern
        UNION
        SELECT i.record_id FROM public.identifiers i JOIN public.records r ON r.id = i.record_id JOIN public.works w ON w.id = r.work_id, q, me
        WHERE w.user_id = me.uid AND i.normalized_value ILIKE q.pattern
        UNION
        SELECT r.id AS record_id FROM public.works w JOIN public.records r ON r.work_id = w.id, q, me
        WHERE w.user_id = me.uid AND w.search_vector @@ q.tsq
        UNION
        SELECT r.id FROM public.records r JOIN public.works w ON w.id = r.work_id, q, me
        WHERE w.user_id = me.uid AND r.search_vector @@ q.tsq
        UNION
        SELECT rc.record_id FROM public.contributors c JOIN public.record_contributors rc ON rc.contributor_id = c.id, me
        WHERE c.user_id = me.uid AND c.display_name OPERATOR(public.%) p_query
        UNION
        SELECT rc.record_id FROM public.contributor_names cn JOIN public.record_contributors rc ON rc.contributor_id = cn.contributor_id, me
        WHERE cn.user_id = me.uid AND cn.name OPERATOR(public.%) p_query
        UNION
        SELECT rc.record_id FROM public.record_contributors rc WHERE rc.credited_as OPERATOR(public.%) p_query
        UNION
        SELECT ra.record_id FROM public.asset_texts t JOIN public.record_assets ra ON ra.asset_id = t.asset_id, q, me
        WHERE t.user_id = me.uid AND t.search_vector @@ q.tsq
    )
    SELECT
        w.id AS work_id,
        r.id AS record_id,
        coalesce(r.title, w.title) AS title,
        greatest(
            CASE WHEN public.unaccent(normalize(coalesce(r.title, w.title), NFC)) ILIKE q.pattern THEN 1.0 ELSE 0.0 END,
            0.1,
            ts_rank(w.search_vector, q.tsq),
            ts_rank(r.search_vector, q.tsq),
            coalesce((SELECT max(public.similarity(c.display_name, p_query))
                      FROM public.record_contributors rc
                      JOIN public.contributors c ON c.id = rc.contributor_id
                      WHERE rc.record_id = r.id), 0),
            coalesce((SELECT max(public.similarity(cn.name, p_query))
                      FROM public.record_contributors rc
                      JOIN public.contributor_names cn ON cn.contributor_id = rc.contributor_id
                      WHERE rc.record_id = r.id), 0),
            coalesce((SELECT max(public.similarity(rc.credited_as, p_query))
                      FROM public.record_contributors rc
                      WHERE rc.record_id = r.id AND rc.credited_as IS NOT NULL), 0),
            coalesce((SELECT max(ts_rank(t.search_vector, q.tsq)) * 0.5
                      FROM public.record_assets ra
                      JOIN public.asset_texts t ON t.asset_id = ra.asset_id
                      WHERE ra.record_id = r.id), 0)
        )::real AS rank
    FROM candidates cd
    JOIN public.records r ON r.id = cd.record_id
    JOIN public.works w ON w.id = r.work_id
    CROSS JOIN q
    CROSS JOIN me
    WHERE w.user_id = me.uid AND btrim(p_query) <> ''
    ORDER BY rank DESC
    LIMIT p_limit;
$$;
-- Supabase grants EXECUTE on new public functions to anon directly, so PUBLIC alone is not enough.
REVOKE ALL ON FUNCTION public.search_library(TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_library(TEXT, INT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
