-- Automatic extraction scheduling must not restart an already indexed/reindexed asset.
CREATE OR REPLACE FUNCTION public.queue_passage_index(p_asset UUID,p_owner UUID) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text||':index',0));
 PERFORM 1 FROM public.jobs WHERE user_id=p_owner AND job_type IN('index_passages','embed_passages') AND payload->>'asset_id'=p_asset::text ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.assets WHERE id=p_asset AND user_id=p_owner AND metadata->'passage_index' IS NOT NULL) THEN RETURN false; END IF;
 RETURN private.queue_passage_index(p_asset,p_owner);
END $$;
