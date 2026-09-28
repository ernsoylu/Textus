-- Row-Level Security. Source: ARCHITECTURE_AND_REQUIREMENTS.md §7.3
-- ---------- Owner-scoped tables (user_id column) ----------
-- works, contributors, tags, collections, reading_states, annotations

ALTER TABLE works ENABLE ROW LEVEL SECURITY;
CREATE POLICY "works_select_own" ON works FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "works_insert_own" ON works FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "works_update_own" ON works FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "works_delete_own" ON works FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

ALTER TABLE contributors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contributors_select_own" ON contributors FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "contributors_insert_own" ON contributors FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "contributors_update_own" ON contributors FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "contributors_delete_own" ON contributors FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tags_select_own" ON tags FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "tags_insert_own" ON tags FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "tags_update_own" ON tags FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "tags_delete_own" ON tags FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collections_select_own" ON collections FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "collections_insert_own" ON collections FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "collections_update_own" ON collections FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "collections_delete_own" ON collections FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

ALTER TABLE reading_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reading_states_select_own" ON reading_states FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "reading_states_insert_own" ON reading_states FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "reading_states_update_own" ON reading_states FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "reading_states_delete_own" ON reading_states FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "annotations_select_own" ON annotations FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "annotations_insert_own" ON annotations FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "annotations_update_own" ON annotations FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "annotations_delete_own" ON annotations FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ---------- RECORDS (ownership via work) ----------
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "records_select" ON records FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM works w WHERE w.id = records.work_id AND w.user_id = (SELECT auth.uid()))
);
CREATE POLICY "records_insert" ON records FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM works w WHERE w.id = records.work_id AND w.user_id = (SELECT auth.uid()))
    AND (container_record_id IS NULL OR private.is_record_owner(container_record_id))
);
CREATE POLICY "records_update" ON records FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM works w WHERE w.id = records.work_id AND w.user_id = (SELECT auth.uid()))
) WITH CHECK (
    EXISTS (SELECT 1 FROM works w WHERE w.id = records.work_id AND w.user_id = (SELECT auth.uid()))
    AND (container_record_id IS NULL OR private.is_record_owner(container_record_id))
);
CREATE POLICY "records_delete" ON records FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM works w WHERE w.id = records.work_id AND w.user_id = (SELECT auth.uid()))
);

-- ---------- IDENTIFIERS (ownership via record) ----------
ALTER TABLE identifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "identifiers_select" ON identifiers FOR SELECT TO authenticated USING (private.is_record_owner(record_id));
CREATE POLICY "identifiers_insert" ON identifiers FOR INSERT TO authenticated WITH CHECK (private.is_record_owner(record_id));
CREATE POLICY "identifiers_update" ON identifiers FOR UPDATE TO authenticated USING (private.is_record_owner(record_id)) WITH CHECK (private.is_record_owner(record_id));
CREATE POLICY "identifiers_delete" ON identifiers FOR DELETE TO authenticated USING (private.is_record_owner(record_id));

-- ---------- RECORD_CONTRIBUTORS ----------
ALTER TABLE record_contributors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "record_contributors_select" ON record_contributors FOR SELECT TO authenticated USING (private.is_record_owner(record_id));
CREATE POLICY "record_contributors_insert" ON record_contributors FOR INSERT TO authenticated WITH CHECK (
    private.is_record_owner(record_id)
    AND EXISTS (SELECT 1 FROM contributors c WHERE c.id = contributor_id AND c.user_id = (SELECT auth.uid()))
);
CREATE POLICY "record_contributors_update" ON record_contributors FOR UPDATE TO authenticated
    USING (private.is_record_owner(record_id))
    WITH CHECK (
        private.is_record_owner(record_id)
        AND EXISTS (SELECT 1 FROM contributors c WHERE c.id = contributor_id AND c.user_id = (SELECT auth.uid()))
    );
CREATE POLICY "record_contributors_delete" ON record_contributors FOR DELETE TO authenticated USING (private.is_record_owner(record_id));

-- ---------- CONTRIBUTOR_NAMES / CONTRIBUTOR_IDENTIFIERS (own rows, own contributor) ----------
ALTER TABLE contributor_names ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contributor_names_select_own" ON contributor_names FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "contributor_names_insert_own" ON contributor_names FOR INSERT TO authenticated WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM contributors c WHERE c.id = contributor_id AND c.user_id = (SELECT auth.uid()))
);
CREATE POLICY "contributor_names_update_own" ON contributor_names FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK (
        (SELECT auth.uid()) = user_id
        AND EXISTS (SELECT 1 FROM contributors c WHERE c.id = contributor_id AND c.user_id = (SELECT auth.uid()))
    );
CREATE POLICY "contributor_names_delete_own" ON contributor_names FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

ALTER TABLE contributor_identifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contributor_identifiers_select_own" ON contributor_identifiers FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "contributor_identifiers_insert_own" ON contributor_identifiers FOR INSERT TO authenticated WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM contributors c WHERE c.id = contributor_id AND c.user_id = (SELECT auth.uid()))
);
CREATE POLICY "contributor_identifiers_update_own" ON contributor_identifiers FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK (
        (SELECT auth.uid()) = user_id
        AND EXISTS (SELECT 1 FROM contributors c WHERE c.id = contributor_id AND c.user_id = (SELECT auth.uid()))
    );
CREATE POLICY "contributor_identifiers_delete_own" ON contributor_identifiers FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ---------- CONTRIBUTOR_DISTINCTIONS (no UPDATE: rows are facts, delete to undo) ----------
ALTER TABLE contributor_distinctions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contributor_distinctions_select_own" ON contributor_distinctions FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "contributor_distinctions_insert_own" ON contributor_distinctions FOR INSERT TO authenticated WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (SELECT count(*) FROM contributors c
         WHERE c.id IN (contributor_a, contributor_b) AND c.user_id = (SELECT auth.uid())) = 2
);
CREATE POLICY "contributor_distinctions_delete_own" ON contributor_distinctions FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ---------- ASSETS ----------
-- Clients: SELECT only. INSERT (after upload verification), UPDATE (processing state)
-- and DELETE (garbage collection of unreferenced assets) are service-role only.
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assets_select_own" ON assets FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ---------- RECORD_ASSETS ----------
-- Clients may view and unlink. Linking happens in the upload function (service role).
ALTER TABLE record_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "record_assets_select" ON record_assets FOR SELECT TO authenticated USING (private.is_record_owner(record_id));
CREATE POLICY "record_assets_delete" ON record_assets FOR DELETE TO authenticated USING (private.is_record_owner(record_id));

-- ---------- RECORD_TAGS ----------
ALTER TABLE record_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "record_tags_select" ON record_tags FOR SELECT TO authenticated USING (private.is_record_owner(record_id));
CREATE POLICY "record_tags_insert" ON record_tags FOR INSERT TO authenticated WITH CHECK (
    private.is_record_owner(record_id)
    AND EXISTS (SELECT 1 FROM tags t WHERE t.id = tag_id AND t.user_id = (SELECT auth.uid()))
);
CREATE POLICY "record_tags_delete" ON record_tags FOR DELETE TO authenticated USING (private.is_record_owner(record_id));

-- ---------- COLLECTION_RECORDS ----------
ALTER TABLE collection_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collection_records_select" ON collection_records FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM collections c WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid()))
);
CREATE POLICY "collection_records_insert" ON collection_records FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM collections c WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid()))
    AND private.is_record_owner(record_id)
);
CREATE POLICY "collection_records_update" ON collection_records FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM collections c WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid())))
    WITH CHECK (
        EXISTS (SELECT 1 FROM collections c WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid()))
        AND private.is_record_owner(record_id)
    );
CREATE POLICY "collection_records_delete" ON collection_records FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM collections c WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid()))
);

-- ---------- METADATA_CACHE ----------
-- Readable by signed-in users; written only by Edge Functions (service role).
ALTER TABLE metadata_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "metadata_cache_select" ON metadata_cache FOR SELECT TO authenticated USING (TRUE);

-- ---------- JOBS ----------
-- Users can see their own jobs (progress UI). All writes via service role.
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jobs_select_own" ON jobs FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
