BEGIN;
ALTER TABLE public.identifiers DROP CONSTRAINT identifiers_scheme_check;
ALTER TABLE public.identifiers ADD CONSTRAINT identifiers_scheme_check
    CHECK (scheme IN ('isbn', 'doi', 'issn', 'arxiv', 'pmid', 'iso', 'iec', 'astm', 'asme', 'bs'));
NOTIFY pgrst, 'reload schema';
COMMIT;
