CREATE FUNCTION public.set_metadata_contributors(p_record UUID,p_credits JSONB) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_metadata JSONB;
BEGIN
 SELECT metadata INTO v_metadata FROM public.records WHERE id=p_record AND private.is_record_owner(id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'record not owned' USING ERRCODE='42501'; END IF;
 IF coalesce(v_metadata->'locked_fields','[]') ? 'contributors' THEN RETURN false; END IF;
 PERFORM public.set_record_contributors(p_record,p_credits);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.set_metadata_contributors(UUID,JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_metadata_contributors(UUID,JSONB) TO authenticated;
