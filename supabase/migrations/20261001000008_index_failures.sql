-- Keep terminal failure state truthful without changing the checkpoint used by Retry.
CREATE FUNCTION private.index_job_failure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.job_type='index_passages' AND NEW.status='failed' AND OLD.status IS DISTINCT FROM NEW.status THEN
 UPDATE public.assets SET metadata=jsonb_set(jsonb_set(metadata,'{passage_index,status}','"failed"'),'{passage_index,reason}','"Indexing failed. Retry continues from the last checkpoint."')
 WHERE id=(NEW.payload->>'asset_id')::uuid AND user_id=NEW.user_id AND metadata->'passage_index'->>'version'=NEW.payload->>'index_version';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.index_job_failure() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER index_job_failure AFTER UPDATE OF status ON public.jobs FOR EACH ROW EXECUTE FUNCTION private.index_job_failure();
