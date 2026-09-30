-- Library cards open the reader for every format with an in-browser viewer (FR-READ-2/6): MOBI, AZW3, CBZ and DjVu
-- joined PDF and EPUB. Same function as 20260930000003; only the reader target's format list changes.
BEGIN;
CREATE OR REPLACE FUNCTION public.library_page(
    p_q TEXT DEFAULT NULL,
    p_work_type TEXT DEFAULT NULL,
    p_tag UUID DEFAULT NULL,
    p_collection UUID DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_format TEXT DEFAULT NULL,
    p_language TEXT DEFAULT NULL,
    p_ids UUID[] DEFAULT NULL,
    p_sort TEXT DEFAULT 'added',
    p_limit INT DEFAULT 48,
    p_offset INT DEFAULT 0
) RETURNS TABLE (
    work_id UUID, title TEXT, work_type TEXT, language TEXT, created_at TIMESTAMPTZ,
    record_ids UUID[], record_type TEXT, publication_date DATE, credits JSONB,
    tag_ids UUID[], collection_ids UUID[], formats TEXT[], statuses TEXT[],
    last_read_at TIMESTAMPTZ, progress NUMERIC, cover_path TEXT, total BIGINT, user_rating NUMERIC, read_record_id UUID, read_asset_id UUID
) LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE
    searching BOOLEAN := p_q IS NOT NULL AND btrim(p_q) <> '';
    ctes TEXT := '';
    joins TEXT := '';
    conds TEXT := 'true';
    ordering TEXT;
BEGIN
    IF p_ids IS NOT NULL THEN conds := conds || format(' AND w.id = ANY (%L::uuid[])', p_ids); END IF;
    IF p_work_type IS NOT NULL THEN conds := conds || format(' AND w.work_type = %L', p_work_type); END IF;
    IF p_language IS NOT NULL THEN conds := conds || format(' AND w.language = %L', p_language); END IF;
    IF p_tag IS NOT NULL THEN
        conds := conds || format(' AND EXISTS (SELECT 1 FROM public.records r JOIN public.record_tags rt ON rt.record_id = r.id WHERE r.work_id = w.id AND rt.tag_id = %L)', p_tag);
    END IF;
    IF p_collection IS NOT NULL THEN
        conds := conds || format(' AND EXISTS (SELECT 1 FROM public.records r JOIN public.collection_records cr ON cr.record_id = r.id WHERE r.work_id = w.id AND cr.collection_id = %L)', p_collection);
    END IF;
    IF p_status IS NOT NULL THEN
        conds := conds || format(' AND EXISTS (SELECT 1 FROM public.records r LEFT JOIN public.reading_states rs ON rs.record_id = r.id WHERE r.work_id = w.id AND coalesce(rs.status, ''unread'') = %L)', p_status);
    END IF;
    IF p_format IS NOT NULL THEN
        conds := conds || format(' AND EXISTS (SELECT 1 FROM public.records r JOIN public.record_assets ra ON ra.record_id = r.id AND ra.role <> ''cover'' JOIN public.assets a ON a.id = ra.asset_id WHERE r.work_id = w.id AND a.file_format = %L)', p_format);
    END IF;

    IF searching THEN
        -- The library can contain 10,000 records per user; don't silently truncate search at 1,000 hits.
        ctes := format('hits AS MATERIALIZED (SELECT s.work_id, max(s.rank) AS rank FROM public.search_library(%L, 10000) s GROUP BY s.work_id), ', p_q);
        joins := joins || ' JOIN hits h ON h.work_id = w.id';
    END IF;

    -- Sort keys are only computed for the sort asked for, each in a single pass joined by hash.
    IF p_sort = 'relevance' AND searching THEN
        ordering := 'h.rank DESC, w.created_at DESC, w.id';
    ELSIF p_sort = 'title' THEN
        ordering := 'lower(w.title) ASC, w.created_at DESC, w.id';
    ELSIF p_sort = 'author' THEN
        -- the first author (else editor, compiler, translator), sorted by sort name
        joins := joins || ' LEFT JOIN (SELECT DISTINCT ON (r.work_id) r.work_id, c.sort_name AS k FROM public.records r JOIN public.record_contributors rc ON rc.record_id = r.id JOIN public.contributors c ON c.id = rc.contributor_id WHERE rc.role IN (''author'', ''editor'', ''compiler'', ''translator'') ORDER BY r.work_id, CASE rc.role WHEN ''author'' THEN 1 WHEN ''editor'' THEN 2 WHEN ''compiler'' THEN 3 ELSE 4 END, rc.position, r.created_at) sk ON sk.work_id = w.id';
        ordering := 'sk.k ASC NULLS LAST, lower(w.title), w.id';
    ELSIF p_sort = 'published' THEN
        joins := joins || ' LEFT JOIN (SELECT r.work_id, min(r.publication_date) AS k FROM public.records r GROUP BY r.work_id) sk ON sk.work_id = w.id';
        ordering := 'sk.k DESC NULLS LAST, w.created_at DESC, w.id';
    ELSIF p_sort = 'recent' THEN
        joins := joins || ' LEFT JOIN (SELECT r.work_id, max(rs.last_read_at) AS k FROM public.records r JOIN public.reading_states rs ON rs.record_id = r.id GROUP BY r.work_id) sk ON sk.work_id = w.id';
        ordering := 'sk.k DESC NULLS LAST, w.created_at DESC, w.id';
    ELSE
        ordering := 'w.created_at DESC, w.id';
    END IF;

    RETURN QUERY EXECUTE format($q$
        WITH %s page AS (
            SELECT w.id, w.title, w.work_type, w.language, w.created_at, w.user_rating,
                   row_number() OVER (ORDER BY %s) AS rn, count(*) OVER () AS total
            FROM public.works w %s
            WHERE %s
            ORDER BY %s
            LIMIT %s OFFSET %s
        )
        SELECT p.id, p.title, p.work_type, p.language, p.created_at,
            (SELECT array_agg(r.id ORDER BY r.created_at, r.id) FROM public.records r WHERE r.work_id = p.id),
            fr.record_type,
            fr.publication_date,
            coalesce((SELECT jsonb_agg(jsonb_build_object('role', rc.role, 'position', rc.position, 'credited_as', rc.credited_as, 'display_name', c.display_name) ORDER BY rc.position)
                      FROM public.record_contributors rc JOIN public.contributors c ON c.id = rc.contributor_id
                      WHERE rc.record_id = fr.id), '[]'::jsonb),
            coalesce((SELECT array_agg(DISTINCT rt.tag_id) FROM public.records r JOIN public.record_tags rt ON rt.record_id = r.id WHERE r.work_id = p.id), '{}'),
            coalesce((SELECT array_agg(DISTINCT cr.collection_id) FROM public.records r JOIN public.collection_records cr ON cr.record_id = r.id WHERE r.work_id = p.id), '{}'),
            coalesce((SELECT array_agg(DISTINCT a.file_format) FROM public.records r
                      JOIN public.record_assets ra ON ra.record_id = r.id AND ra.role <> 'cover'
                      JOIN public.assets a ON a.id = ra.asset_id WHERE r.work_id = p.id), '{}'),
            coalesce((SELECT array_agg(DISTINCT coalesce(rs.status, 'unread')) FROM public.records r
                      LEFT JOIN public.reading_states rs ON rs.record_id = r.id WHERE r.work_id = p.id), '{unread}'),
            (SELECT max(rs.last_read_at) FROM public.records r JOIN public.reading_states rs ON rs.record_id = r.id WHERE r.work_id = p.id),
            (SELECT max(rs.progress_percentage) FROM public.records r JOIN public.reading_states rs ON rs.record_id = r.id WHERE r.work_id = p.id),
            (SELECT a.storage_path FROM public.records r
             JOIN public.record_assets ra ON ra.record_id = r.id AND ra.role = 'cover'
             JOIN public.assets a ON a.id = ra.asset_id AND a.bucket = 'covers'
             WHERE r.work_id = p.id ORDER BY r.created_at LIMIT 1),
            p.total, p.user_rating, reader.record_id, reader.asset_id
        FROM page p
        LEFT JOIN LATERAL (
            SELECT r.id, r.record_type, r.publication_date FROM public.records r WHERE r.work_id = p.id ORDER BY r.created_at, r.id LIMIT 1
        ) fr ON TRUE
        LEFT JOIN LATERAL (
            SELECT r.id AS record_id, a.id AS asset_id
            FROM public.records r
            JOIN public.record_assets ra ON ra.record_id = r.id AND ra.role <> 'cover'
            JOIN public.assets a ON a.id = ra.asset_id AND a.bucket = 'documents' AND a.file_format IN ('pdf', 'epub', 'mobi', 'azw3', 'cbz', 'djvu')
            WHERE r.work_id = p.id
            ORDER BY (ra.role = 'primary') DESC, r.created_at, r.id, a.id LIMIT 1
        ) reader ON TRUE
        ORDER BY p.rn
    $q$, ctes, ordering, joins, conds, ordering, least(greatest(p_limit, 1), 100), least(greatest(p_offset, 0), 10000));
END;
$fn$;

REVOKE ALL ON FUNCTION public.library_page(TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.library_page(TEXT, TEXT, UUID, UUID, TEXT, TEXT, TEXT, UUID[], TEXT, INT, INT) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
