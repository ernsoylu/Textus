BEGIN;

ALTER TABLE public.works DROP CONSTRAINT works_work_type_check;
ALTER TABLE public.works ADD CONSTRAINT works_work_type_check
    CHECK (work_type IN ('book', 'article', 'chapter', 'serial', 'thesis', 'report', 'standard', 'other'));

ALTER TABLE public.records DROP CONSTRAINT records_record_type_check;
ALTER TABLE public.records ADD CONSTRAINT records_record_type_check
    CHECK (record_type IN ('edition', 'article_version', 'chapter', 'issue', 'report', 'thesis', 'standard', 'other'));

COMMIT;
