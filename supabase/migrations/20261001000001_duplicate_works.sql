-- FR-CAT-7: other works in the caller's library that are likely the same as p_work_id, strongest evidence first:
-- same_file (a shared non-cover asset, i.e. identical bytes), identifier (a shared ISBN/DOI/arXiv/PMID/standard
-- number; ISSN is skipped because it names a serial, not one item), title_author (similar folded title + subtitle,
-- so a subtitle split off or kept in the title still matches while sequels like Dune / Dune Messiah do not, and a
-- shared contributor match_key). Warnings only: works are never merged automatically.
-- SECURITY INVOKER, so RLS limits every joined table to the caller's rows.
CREATE OR REPLACE FUNCTION public.find_duplicate_works(p_work_id UUID)
RETURNS TABLE (work_id UUID, title TEXT, reason TEXT)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    WITH target AS (
        SELECT w.id, w.user_id, lower(public.unaccent(normalize(concat_ws(' ', w.title, w.subtitle), NFC))) AS folded
        FROM public.works w WHERE w.id = p_work_id
    ),
    matches AS (
        SELECT r2.work_id, 1 AS strength, 'same_file' AS reason
        FROM target t
        JOIN public.records r ON r.work_id = t.id
        JOIN public.record_assets ra ON ra.record_id = r.id AND ra.role NOT IN ('cover', 'thumbnail')
        JOIN public.record_assets ra2 ON ra2.asset_id = ra.asset_id AND ra2.role NOT IN ('cover', 'thumbnail')
        JOIN public.records r2 ON r2.id = ra2.record_id
        UNION ALL
        SELECT r2.work_id, 2, 'identifier'
        FROM target t
        JOIN public.records r ON r.work_id = t.id
        JOIN public.identifiers i ON i.record_id = r.id AND i.scheme <> 'issn'
        JOIN public.identifiers i2 ON i2.scheme = i.scheme AND i2.normalized_value = i.normalized_value
        JOIN public.records r2 ON r2.id = i2.record_id
        UNION ALL
        -- ponytail: trigram similarity is computed per candidate sharing a match_key; add a folded-title
        -- trigram index if large libraries make this slow.
        SELECT r2.work_id, 3, 'title_author'
        FROM target t
        JOIN public.records r ON r.work_id = t.id
        JOIN public.record_contributors rc ON rc.record_id = r.id
        JOIN public.contributors c ON c.id = rc.contributor_id
        JOIN public.contributors c2 ON c2.user_id = t.user_id AND c2.match_key = c.match_key
        JOIN public.record_contributors rc2 ON rc2.contributor_id = c2.id
        JOIN public.records r2 ON r2.id = rc2.record_id
        JOIN public.works w2 ON w2.id = r2.work_id
        WHERE public.similarity(lower(public.unaccent(normalize(concat_ws(' ', w2.title, w2.subtitle), NFC))), t.folded) >= 0.6
    )
    SELECT d.work_id, d.title, d.reason FROM (
        SELECT DISTINCT ON (w.id) w.id AS work_id, w.title, m.reason, m.strength
        FROM matches m
        JOIN public.works w ON w.id = m.work_id
        JOIN target t ON w.user_id = t.user_id AND w.id <> t.id
        ORDER BY w.id, m.strength
    ) d
    ORDER BY d.strength, d.title;
$$;
