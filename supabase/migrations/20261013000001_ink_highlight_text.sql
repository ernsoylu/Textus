-- FR-READ-10: a freehand highlighter stroke keeps the text it covers (≤2000 characters) in highlighted_text, so
-- it is listed, searched and exported like a text highlight. Pen strokes still carry no text. Otherwise unchanged
-- from 20261012000001_pdf_ink.sql. On app102 apply as supabase_admin, which owns this function there.
CREATE OR REPLACE FUNCTION private.check_annotation_ink() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
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
    AND (NEW.highlighted_text IS NULL OR (d->>'tool' = 'highlighter' AND char_length(NEW.highlighted_text) <= 2000));
  IF NOT coalesce(ok, false) THEN
    RAISE EXCEPTION 'invalid ink stroke' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
