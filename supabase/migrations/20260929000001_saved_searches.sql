-- FR-ORG-5: saved searches (virtual libraries). `filters` is the library filter/sort state,
-- validated with Zod in the SPA; the server treats it as opaque.
CREATE TABLE saved_searches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
    filters JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "saved_searches_select_own" ON saved_searches FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "saved_searches_insert_own" ON saved_searches FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "saved_searches_update_own" ON saved_searches FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "saved_searches_delete_own" ON saved_searches FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
