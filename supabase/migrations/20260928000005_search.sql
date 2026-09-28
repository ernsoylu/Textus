-- FR-SRCH-1: full-text search on title/subtitle/abstract plus fuzzy matching on contributor
-- names, per §15 open question #6's proposed resolution — one SQL function combining FTS on
-- works/records with trigram on contributors.display_name, contributor_names.name, and
-- record_contributors.credited_as. SECURITY INVOKER: RLS on records/works/contributors scopes
-- results to the caller automatically, same as contributor_candidates() etc.

CREATE INDEX idx_record_contributors_credited_trgm
    ON record_contributors USING GIN (credited_as gin_trgm_ops) WHERE credited_as IS NOT NULL;

CREATE OR REPLACE FUNCTION public.search_library(p_query TEXT, p_limit INT DEFAULT 50)
RETURNS TABLE (work_id UUID, record_id UUID, title TEXT, rank REAL)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT
        w.id AS work_id,
        r.id AS record_id,
        coalesce(r.title, w.title) AS title,
        greatest(
            ts_rank(w.search_vector, websearch_to_tsquery('english', p_query)),
            ts_rank(r.search_vector, websearch_to_tsquery('english', p_query)),
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
                      WHERE rc.record_id = r.id AND rc.credited_as IS NOT NULL), 0)
        )::real AS rank
    FROM public.records r
    JOIN public.works w ON w.id = r.work_id
    WHERE w.search_vector @@ websearch_to_tsquery('english', p_query)
       OR r.search_vector @@ websearch_to_tsquery('english', p_query)
       OR EXISTS (SELECT 1 FROM public.record_contributors rc JOIN public.contributors c ON c.id = rc.contributor_id
                  WHERE rc.record_id = r.id AND c.display_name OPERATOR(public.%) p_query)
       OR EXISTS (SELECT 1 FROM public.record_contributors rc JOIN public.contributor_names cn ON cn.contributor_id = rc.contributor_id
                  WHERE rc.record_id = r.id AND cn.name OPERATOR(public.%) p_query)
       OR EXISTS (SELECT 1 FROM public.record_contributors rc
                  WHERE rc.record_id = r.id AND rc.credited_as OPERATOR(public.%) p_query)
    ORDER BY rank DESC
    LIMIT p_limit;
$$;
