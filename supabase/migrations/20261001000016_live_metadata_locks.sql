-- Recheck locks at commit time: a stale review cannot overwrite a newer manual edit.
CREATE FUNCTION public.apply_metadata_fields(p_work UUID,p_record UUID,p_work_patch JSONB,p_record_patch JSONB,p_metadata_patch JSONB) RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.works;r public.records;wp JSONB;rp JSONB;mp JSONB;
BEGIN
 SELECT * INTO w FROM public.works WHERE id=p_work AND user_id=auth.uid() FOR UPDATE;
 SELECT * INTO r FROM public.records WHERE id=p_record AND work_id=p_work FOR UPDATE;
 IF w.id IS NULL OR r.id IS NULL THEN RAISE EXCEPTION 'record not owned' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO wp FROM jsonb_each(p_work_patch) WHERE key=ANY(ARRAY['title','subtitle','abstract','language','work_type']) AND NOT coalesce(w.metadata->'locked_fields','[]') ? key;
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO rp FROM jsonb_each(p_record_patch) WHERE key=ANY(ARRAY['publication_date','publication_date_precision','publisher','edition','volume','issue_number','pages','record_type','metadata_source','metadata_fetched_at']) AND NOT coalesce(r.metadata->'locked_fields','[]') ? key AND NOT (key='publication_date_precision' AND coalesce(r.metadata->'locked_fields','[]') ? 'publication_date');
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO mp FROM jsonb_each(p_metadata_patch) WHERE key=ANY(ARRAY['container_title','standard_status','source_url']) AND NOT coalesce(r.metadata->'locked_fields','[]') ? key;
 w=jsonb_populate_record(w,wp);r=jsonb_populate_record(r,rp);
 UPDATE public.works SET title=w.title,subtitle=w.subtitle,abstract=w.abstract,language=w.language,work_type=w.work_type WHERE id=p_work;
 UPDATE public.records SET publication_date=r.publication_date,publication_date_precision=r.publication_date_precision,publisher=r.publisher,edition=r.edition,volume=r.volume,issue_number=r.issue_number,pages=r.pages,record_type=r.record_type,metadata_source=r.metadata_source,metadata_fetched_at=r.metadata_fetched_at,metadata=coalesce(metadata,'{}')||mp WHERE id=p_record;
END $$;
REVOKE ALL ON FUNCTION public.apply_metadata_fields(UUID,UUID,JSONB,JSONB,JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.apply_metadata_fields(UUID,UUID,JSONB,JSONB,JSONB) TO authenticated;
