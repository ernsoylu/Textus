-- Existing M1 catalog values were entered by users before field locks existed.
UPDATE public.works AS w
SET metadata = jsonb_set(w.metadata, '{locked_fields}', (
    SELECT to_jsonb(array_agg(field)) FROM (
        VALUES ('title', TRUE), ('work_type', TRUE), ('subtitle', w.subtitle IS NOT NULL),
               ('abstract', w.abstract IS NOT NULL)
    ) AS candidate(field, present) WHERE present
))
WHERE NOT (w.metadata ? 'locked_fields');

UPDATE public.records AS r
SET metadata = jsonb_set(coalesce(r.metadata, '{}'::jsonb), '{locked_fields}', (
    SELECT coalesce(to_jsonb(array_agg(field)), '[]'::jsonb) FROM (
        VALUES ('title', r.title IS NOT NULL), ('publisher', r.publisher IS NOT NULL),
               ('edition', r.edition IS NOT NULL), ('volume', r.volume IS NOT NULL),
               ('issue_number', r.issue_number IS NOT NULL), ('pages', r.pages IS NOT NULL),
               ('publication_date', r.publication_date IS NOT NULL),
               ('contributors', EXISTS (SELECT 1 FROM public.record_contributors rc WHERE rc.record_id = r.id))
    ) AS candidate(field, present) WHERE present
))
WHERE NOT (coalesce(r.metadata, '{}'::jsonb) ? 'locked_fields') AND r.metadata_source IS NULL;
