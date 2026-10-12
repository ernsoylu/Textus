-- FR-READ-10 / NFR-REL-5 (M7.3): PDF page ink. One annotation row per pen or highlighter stroke, anchored like
-- every annotation to the owner's record and immutable asset (existing RLS: both sides must be the caller's).
-- anchor_data = {v: 1, page, tool: pen|highlighter, width, points: [[x, y(, pressure)], ...]} with x, y and
-- pressure in 0–1 page fractions of the unrotated page and width a fraction of the page width. The client
-- validates the same bounds (src/hooks/useAnnotations.ts inkDataSchema); this trigger is the trust boundary.
ALTER TABLE public.annotations DROP CONSTRAINT annotations_anchor_type_check;
ALTER TABLE public.annotations ADD CONSTRAINT annotations_anchor_type_check
    CHECK (anchor_type IN ('pdf_page', 'epub_cfi', 'text_quote', 'pdf_ink'));

CREATE FUNCTION private.check_annotation_ink() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  d jsonb := NEW.anchor_data;
  ok boolean;
BEGIN
  IF NEW.anchor_type <> 'pdf_ink' THEN
    RETURN NEW;
  END IF;
  ok := jsonb_typeof(d) = 'object'
    AND octet_length(d::text) <= 65536
    AND (SELECT count(*) FROM jsonb_object_keys(d)) = 5
    AND d->'v' = '1'::jsonb
    AND jsonb_typeof(d->'page') = 'number' AND (d->>'page')::numeric >= 1 AND (d->>'page')::numeric = trunc((d->>'page')::numeric)
    AND d->>'tool' IN ('pen', 'highlighter')
    AND jsonb_typeof(d->'width') = 'number' AND (d->>'width')::numeric BETWEEN 0.0005 AND 0.05
    AND jsonb_typeof(d->'points') = 'array' AND jsonb_array_length(d->'points') BETWEEN 1 AND 2000
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(d->'points') p
      WHERE jsonb_typeof(p) <> 'array' OR jsonb_array_length(p) NOT IN (2, 3)
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(p) v WHERE jsonb_typeof(v) <> 'number' OR (v #>> '{}')::numeric NOT BETWEEN 0 AND 1)
    )
    AND NEW.highlighted_text IS NULL;
  IF NOT coalesce(ok, false) THEN
    RAISE EXCEPTION 'invalid ink stroke' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER annotations_check_ink BEFORE INSERT OR UPDATE ON public.annotations
    FOR EACH ROW EXECUTE FUNCTION private.check_annotation_ink();

-- A page of handwriting is hundreds of strokes (and undo/redo/erase operations); logging each as a work event
-- would bury the history, so ink is left out of it. Otherwise unchanged from 20261001000037_work_history.sql.
CREATE OR REPLACE FUNCTION private.history_annotations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner RECORD; a public.annotations := coalesce(NEW, OLD); place TEXT; what TEXT; changes JSONB;
BEGIN
  IF a.anchor_type = 'pdf_ink' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO owner FROM private.record_owner(a.record_id);
  place := coalesce(' on page ' || (a.anchor_data->>'page'), '');
  what := CASE WHEN a.note IS NOT NULL AND a.highlighted_text IS NULL THEN 'note' ELSE 'highlight' END;
  IF TG_OP = 'INSERT' THEN
    PERFORM private.log_work_event(owner.user_id, owner.work_id, a.record_id, a.asset_id, 'annotation.added',
      'Added a ' || what || place || coalesce(': “' || left(a.highlighted_text, 120) || '”', ''),
      private.row_changes('{}', to_jsonb(NEW), ARRAY['highlighted_text','note','color']));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.log_work_event(owner.user_id, owner.work_id, a.record_id, a.asset_id, 'annotation.removed',
      'Removed a ' || what || place || coalesce(': “' || left(a.highlighted_text, 120) || '”', ''),
      private.row_changes(to_jsonb(OLD), '{}', ARRAY['highlighted_text','note','color','anchor_data']));
  ELSE
    changes := private.row_changes(to_jsonb(OLD), to_jsonb(NEW), ARRAY['highlighted_text','note','color','anchor_data']);
    IF changes IS NOT NULL THEN
      PERFORM private.log_work_event(owner.user_id, owner.work_id, a.record_id, a.asset_id, 'annotation.updated',
        CASE WHEN changes ? 'note' THEN 'Edited a note' ELSE 'Edited a highlight' END || place, changes);
    END IF;
  END IF;
  RETURN NULL;
END $$;
