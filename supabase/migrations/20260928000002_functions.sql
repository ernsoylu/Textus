-- Functions and triggers. Source: ARCHITECTURE_AND_REQUIREMENTS.md §7.2
-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER works_updated_at          BEFORE UPDATE ON works          FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER contributors_updated_at   BEFORE UPDATE ON contributors   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER records_updated_at        BEFORE UPDATE ON records        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER assets_updated_at         BEFORE UPDATE ON assets         FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER collections_updated_at    BEFORE UPDATE ON collections    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER reading_states_updated_at BEFORE UPDATE ON reading_states FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER annotations_updated_at    BEFORE UPDATE ON annotations    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Asset immutability: enforced for every role, including service_role.
-- Only processing_state, processing_error, metadata, updated_at may change.
CREATE OR REPLACE FUNCTION public.prevent_asset_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF (NEW.user_id, NEW.bucket, NEW.storage_path, NEW.file_size, NEW.checksum_sha256, NEW.mime_type, NEW.file_format)
       IS DISTINCT FROM
       (OLD.user_id, OLD.bucket, OLD.storage_path, OLD.file_size, OLD.checksum_sha256, OLD.mime_type, OLD.file_format) THEN
        RAISE EXCEPTION 'assets are immutable; create a new asset instead';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER assets_immutable BEFORE UPDATE ON assets
    FOR EACH ROW EXECUTE FUNCTION prevent_asset_mutation();

-- Ownership check for record-scoped rows. SECURITY DEFINER avoids nested RLS
-- evaluation; it only ever answers for the calling user.
CREATE OR REPLACE FUNCTION private.is_record_owner(p_record_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.records r
        JOIN public.works w ON w.id = r.work_id
        WHERE r.id = p_record_id AND w.user_id = (SELECT auth.uid())
    );
$$;

-- Job claiming for the worker (service role only).
-- ponytail: jobs whose lease expired at max_attempts stay 'running'; the worker marks them failed.
CREATE OR REPLACE FUNCTION public.claim_jobs(p_limit INT DEFAULT 5, p_lease INTERVAL DEFAULT '5 minutes')
RETURNS SETOF public.jobs LANGUAGE sql SET search_path = '' AS $$
    UPDATE public.jobs j
    SET status = 'running',
        attempts = j.attempts + 1,
        started_at = NOW(),
        lease_expires_at = NOW() + p_lease
    WHERE j.id IN (
        SELECT id FROM public.jobs
        WHERE attempts < max_attempts
          AND (status = 'queued' OR (status = 'running' AND lease_expires_at < NOW()))
        ORDER BY created_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING j.*;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_jobs(INT, INTERVAL) FROM PUBLIC, anon, authenticated;

-- Replace a record's whole credit list atomically. The contributor editor saves through this,
-- so reordering never trips UNIQUE (record_id, role, position).
CREATE OR REPLACE FUNCTION public.set_record_contributors(p_record_id UUID, p_credits JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF NOT private.is_record_owner(p_record_id) THEN
        RAISE EXCEPTION 'record not found';
    END IF;
    DELETE FROM public.record_contributors WHERE record_id = p_record_id;
    INSERT INTO public.record_contributors
        (record_id, contributor_id, role, position, credited_as, affiliation, resolved_by)
    SELECT p_record_id, c.contributor_id, c.role, c.position, c.credited_as, c.affiliation, coalesce(c.resolved_by, 'user')
    FROM jsonb_to_recordset(p_credits)
        AS c(contributor_id UUID, role TEXT, position INT, credited_as TEXT, affiliation TEXT, resolved_by TEXT);
END;
$$;

-- Merge p_merge into p_keep. Refuses conflicting external IDs unless p_force.
CREATE OR REPLACE FUNCTION public.merge_contributors(p_keep UUID, p_merge UUID, p_force BOOLEAN DEFAULT FALSE)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF p_keep = p_merge THEN
        RAISE EXCEPTION 'cannot merge a contributor into itself';
    END IF;
    IF (SELECT count(*) FROM public.contributors WHERE id IN (p_keep, p_merge)) <> 2 THEN
        RAISE EXCEPTION 'contributor not found';
    END IF;
    IF NOT p_force AND EXISTS (
        SELECT 1 FROM public.contributor_identifiers k
        JOIN public.contributor_identifiers m ON m.scheme = k.scheme AND m.value <> k.value
        WHERE k.contributor_id = p_keep AND m.contributor_id = p_merge
    ) THEN
        RAISE EXCEPTION 'conflicting external identifiers; these look like different people';
    END IF;

    -- Credits: drop ones p_keep already holds on the same record and role, move the rest.
    DELETE FROM public.record_contributors m
    USING public.record_contributors k
    WHERE m.contributor_id = p_merge AND k.contributor_id = p_keep
      AND k.record_id = m.record_id AND k.role = m.role;
    UPDATE public.record_contributors SET contributor_id = p_keep WHERE contributor_id = p_merge;

    -- Names: the merged display name and its variants become variants of p_keep.
    INSERT INTO public.contributor_names (user_id, contributor_id, name, match_key, name_type)
    SELECT user_id, p_keep, display_name, match_key, 'variant' FROM public.contributors WHERE id = p_merge
    UNION ALL
    SELECT user_id, p_keep, name, match_key, name_type FROM public.contributor_names WHERE contributor_id = p_merge
    ON CONFLICT (contributor_id, name) DO NOTHING;

    UPDATE public.contributor_identifiers SET contributor_id = p_keep WHERE contributor_id = p_merge;
    DELETE FROM public.contributors WHERE id = p_merge; -- cascades leftover names and distinctions
END;
$$;

-- Split: move selected credits to another contributor and remember that the two differ.
CREATE OR REPLACE FUNCTION public.reassign_credits(p_from UUID, p_to UUID, p_record_ids UUID[])
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    UPDATE public.record_contributors SET contributor_id = p_to, resolved_by = 'user'
    WHERE contributor_id = p_from AND record_id = ANY(p_record_ids);
    INSERT INTO public.contributor_distinctions (user_id, contributor_a, contributor_b)
    VALUES ((SELECT auth.uid()), LEAST(p_from, p_to), GREATEST(p_from, p_to))
    ON CONFLICT DO NOTHING;
END;
$$;

-- Matching candidates with their evidence (§6.3). Scoring happens in shared/names.ts.
-- ponytail: co-author/affiliation arrays are unbounded; cap them if large-collaboration papers make this slow.
CREATE OR REPLACE FUNCTION public.contributor_candidates(p_match_keys TEXT[])
RETURNS TABLE (
    contributor_id UUID, match_key TEXT, kind TEXT, display_name TEXT, given_names TEXT,
    birth_year SMALLINT, death_year SMALLINT, names TEXT[],
    identifiers JSONB, coauthor_keys TEXT[], affiliations TEXT[], work_ids UUID[]
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    WITH hits AS (
        SELECT c.id, c.match_key FROM public.contributors c WHERE c.match_key = ANY(p_match_keys)
        UNION
        SELECT n.contributor_id, n.match_key FROM public.contributor_names n WHERE n.match_key = ANY(p_match_keys)
    )
    SELECT c.id, h.match_key, c.kind, c.display_name, c.given_names, c.birth_year, c.death_year,
        ARRAY(SELECT n.name FROM public.contributor_names n WHERE n.contributor_id = c.id),
        (SELECT coalesce(jsonb_object_agg(i.scheme, i.value), '{}'::jsonb)
           FROM public.contributor_identifiers i WHERE i.contributor_id = c.id),
        ARRAY(SELECT DISTINCT o.match_key
              FROM public.record_contributors rc
              JOIN public.record_contributors rc2 ON rc2.record_id = rc.record_id AND rc2.contributor_id <> c.id
              JOIN public.contributors o ON o.id = rc2.contributor_id
              WHERE rc.contributor_id = c.id),
        ARRAY(SELECT DISTINCT rc.affiliation FROM public.record_contributors rc
              WHERE rc.contributor_id = c.id AND rc.affiliation IS NOT NULL),
        ARRAY(SELECT DISTINCT r.work_id FROM public.record_contributors rc
              JOIN public.records r ON r.id = rc.record_id WHERE rc.contributor_id = c.id)
    FROM hits h JOIN public.contributors c ON c.id = h.id;
$$;

-- Review queue: same-key pairs without a recorded distinction or conflicting IDs.
-- Given-name compatibility is checked client-side with compareGiven().
CREATE OR REPLACE FUNCTION public.possible_duplicate_contributors()
RETURNS TABLE (contributor_a UUID, contributor_b UUID)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT a.id, b.id
    FROM public.contributors a
    JOIN public.contributors b ON b.user_id = a.user_id AND b.match_key = a.match_key AND a.id < b.id
    WHERE NOT EXISTS (SELECT 1 FROM public.contributor_distinctions d
                      WHERE d.contributor_a = a.id AND d.contributor_b = b.id)
      AND NOT EXISTS (SELECT 1 FROM public.contributor_identifiers ia
                      JOIN public.contributor_identifiers ib ON ib.scheme = ia.scheme AND ib.value <> ia.value
                      WHERE ia.contributor_id = a.id AND ib.contributor_id = b.id);
$$;
