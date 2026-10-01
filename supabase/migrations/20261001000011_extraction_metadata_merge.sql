-- Extraction must not overwrite a passage checkpoint created after it read the asset.
CREATE FUNCTION public.merge_extraction_metadata(p_asset UUID,p_owner UUID,p_patch JSONB) RETURNS JSONB LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v_metadata JSONB;
BEGIN
 IF p_patch ? 'passage_index' THEN RAISE EXCEPTION 'index checkpoint is reserved'; END IF;
 UPDATE public.assets SET metadata=coalesce(metadata,'{}')||p_patch,processing_state='ready',processing_error=NULL WHERE id=p_asset AND user_id=p_owner AND deleting_at IS NULL RETURNING metadata INTO v_metadata;
 RETURN v_metadata;
END $$;
REVOKE ALL ON FUNCTION public.merge_extraction_metadata(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.merge_extraction_metadata(UUID,UUID,JSONB) TO service_role;
