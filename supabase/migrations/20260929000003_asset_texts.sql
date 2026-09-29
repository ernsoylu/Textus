-- Extracted file text feeds search (FR-SRCH-1, README "feeds search"). The job worker reads PDF/EPUB text and
-- stores a capped copy here, in its own table so `assets` rows (and every query that embeds them) stay small.
CREATE TABLE asset_texts (
    asset_id UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    -- tsvector values are limited to 1 MB, so index only the first 100,000 characters.
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', left(content, 100000))) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_asset_texts_search ON asset_texts USING GIN (search_vector);
CREATE INDEX idx_asset_texts_user ON asset_texts (user_id);

-- RLS (invariant 4): owners may read; there is deliberately no INSERT/UPDATE/DELETE policy, so only the
-- job worker (service role) writes, and rows disappear with their asset or user (ON DELETE CASCADE).
ALTER TABLE asset_texts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "asset_texts_select_own" ON asset_texts FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- search_library() now also matches the text of a record's files (a text hit ranks below a title hit), and is
-- restructured for NFR-PERF-1: candidate records come from six indexed lookups (works/records/file-text full-text
-- search, and trigram matches on contributor names, name variants and printed names) and only those candidates are
-- ranked.
--
-- SECURITY DEFINER, deliberately (ARCHITECTURE §14 #23): under SECURITY INVOKER, RLS makes Postgres apply
-- the per-row policy check *before* the trigram / full-text qual, because those operators are not "leakproof", so the
-- GIN indexes go unused and a 10,000-record search took ~400 ms. Here every leg is scoped to the caller with an explicit
-- auth.uid() filter instead, and the final join back to works enforces ownership again, so no other user's row can
-- appear. search_path is empty; execute is revoked from everyone but signed-in users.
CREATE OR REPLACE FUNCTION public.search_library(p_query TEXT, p_limit INT DEFAULT 50)
RETURNS TABLE (work_id UUID, record_id UUID, title TEXT, rank REAL)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    WITH me AS (SELECT (SELECT auth.uid()) AS uid),
    q AS (SELECT websearch_to_tsquery('english', p_query) AS tsq),
    candidates AS (
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
    WHERE w.user_id = me.uid
    ORDER BY rank DESC
    LIMIT p_limit;
$$;
-- Supabase grants EXECUTE on new public functions to anon directly, so PUBLIC alone is not enough.
REVOKE ALL ON FUNCTION public.search_library(TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_library(TEXT, INT) TO authenticated, service_role;
