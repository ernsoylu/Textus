-- Model-derived suggestions never enter the shared provider cache or overwrite catalog fields.
CREATE FUNCTION public.store_ai_metadata_suggestion(p_user UUID,p_record UUID,p_asset UUID,p_key TEXT,p_data JSONB) RETURNS BOOLEAN LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF p_key NOT LIKE 'llm:%' OR octet_length(p_data::text)>16000 THEN RAISE EXCEPTION 'invalid suggestion'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.records r JOIN public.works w ON w.id=r.work_id JOIN public.record_assets ra ON ra.record_id=r.id JOIN public.assets a ON a.id=ra.asset_id WHERE r.id=p_record AND w.user_id=p_user AND a.id=p_asset AND a.user_id=p_user AND a.deleting_at IS NULL) THEN RETURN false; END IF;
 UPDATE public.records SET metadata=jsonb_set(coalesce(metadata,'{}'),'{lookup_suggestions}',coalesce(metadata->'lookup_suggestions','{}')||jsonb_build_object(p_key,jsonb_build_object('data',p_data,'fetched_at',now()))) WHERE id=p_record;
 RETURN true;
END $$;
CREATE FUNCTION public.defer_ai_job(p_id UUID,p_generation BIGINT,p_reason TEXT) RETURNS BOOLEAN LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 UPDATE public.jobs SET status='queued',attempts=greatest(0,attempts-1),available_at=now()+interval '5 minutes',lease_expires_at=NULL,result=jsonb_build_object('paused',p_reason)
 WHERE id=p_id AND claim_generation=p_generation AND status='running' AND lease_expires_at>now() AND job_type IN('extract_metadata_ai','embed_passages');
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.store_ai_metadata_suggestion(UUID,UUID,UUID,TEXT,JSONB),public.defer_ai_job(UUID,BIGINT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.store_ai_metadata_suggestion(UUID,UUID,UUID,TEXT,JSONB),public.defer_ai_job(UUID,BIGINT,TEXT) TO service_role;
