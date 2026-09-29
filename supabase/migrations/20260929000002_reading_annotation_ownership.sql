-- §15 open question 3: reading_states and annotations checked only user_id on write, so a user could
-- point their own row at someone else's record or asset (dangling reference, not a data leak).
-- Both sides must now belong to the caller, as for every other junction table (invariant 4).
DROP POLICY "reading_states_insert_own" ON reading_states;
DROP POLICY "reading_states_update_own" ON reading_states;
CREATE POLICY "reading_states_insert_own" ON reading_states FOR INSERT TO authenticated WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND private.is_record_owner(record_id)
    AND (asset_id IS NULL OR EXISTS (SELECT 1 FROM assets a WHERE a.id = asset_id AND a.user_id = (SELECT auth.uid())))
);
CREATE POLICY "reading_states_update_own" ON reading_states FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK (
        (SELECT auth.uid()) = user_id
        AND private.is_record_owner(record_id)
        AND (asset_id IS NULL OR EXISTS (SELECT 1 FROM assets a WHERE a.id = asset_id AND a.user_id = (SELECT auth.uid())))
    );

DROP POLICY "annotations_insert_own" ON annotations;
DROP POLICY "annotations_update_own" ON annotations;
CREATE POLICY "annotations_insert_own" ON annotations FOR INSERT TO authenticated WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND private.is_record_owner(record_id)
    AND EXISTS (SELECT 1 FROM assets a WHERE a.id = asset_id AND a.user_id = (SELECT auth.uid()))
);
CREATE POLICY "annotations_update_own" ON annotations FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK (
        (SELECT auth.uid()) = user_id
        AND private.is_record_owner(record_id)
        AND EXISTS (SELECT 1 FROM assets a WHERE a.id = asset_id AND a.user_id = (SELECT auth.uid()))
    );
