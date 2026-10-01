-- M6.0: durable upload completion, deletion claims and fenced worker leases.
CREATE TABLE public.upload_attempts (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  id UUID NOT NULL,
  record_id UUID NOT NULL REFERENCES public.records(id) ON DELETE CASCADE,
  intent JSONB NOT NULL,
  request JSONB,
  result JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);
ALTER TABLE public.upload_attempts ENABLE ROW LEVEL SECURITY;
-- Service-only: callers reach this through the validated upload endpoint.
REVOKE ALL ON public.upload_attempts FROM anon, authenticated;

ALTER TABLE public.assets ADD COLUMN deleting_at TIMESTAMPTZ;
CREATE TABLE public.storage_deletions (
  bucket TEXT NOT NULL CHECK (bucket IN ('staging', 'documents', 'covers')),
  path TEXT NOT NULL,
  asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket, path)
);
ALTER TABLE public.storage_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storage_deletions FROM anon, authenticated;

CREATE FUNCTION private.guard_asset_link() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_asset public.assets; v_owner UUID;
BEGIN
  SELECT * INTO v_asset FROM public.assets WHERE id = NEW.asset_id FOR UPDATE;
  SELECT w.user_id INTO v_owner FROM public.records r JOIN public.works w ON w.id=r.work_id WHERE r.id=NEW.record_id;
  IF v_asset.id IS NULL OR v_asset.deleting_at IS NOT NULL OR v_owner IS DISTINCT FROM v_asset.user_id THEN
    RAISE EXCEPTION 'asset unavailable or ownership mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_asset_link BEFORE INSERT OR UPDATE ON public.record_assets FOR EACH ROW EXECUTE FUNCTION private.guard_asset_link();
CREATE FUNCTION private.guard_collection_cover() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_asset public.assets;
BEGIN
  IF NEW.cover_asset_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_asset FROM public.assets WHERE id=NEW.cover_asset_id FOR UPDATE;
  IF v_asset.id IS NULL OR v_asset.deleting_at IS NOT NULL OR NEW.user_id IS DISTINCT FROM v_asset.user_id THEN
    RAISE EXCEPTION 'cover unavailable or ownership mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_collection_cover BEFORE INSERT OR UPDATE OF cover_asset_id, user_id ON public.collections FOR EACH ROW EXECUTE FUNCTION private.guard_collection_cover();
REVOKE ALL ON FUNCTION private.guard_asset_link(), private.guard_collection_cover() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.begin_upload(p_user UUID, p_id UUID, p_record UUID, p_intent JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_attempt public.upload_attempts;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.records r JOIN public.works w ON w.id=r.work_id WHERE r.id=p_record AND w.user_id=p_user) THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.upload_attempts(user_id,id,record_id,intent) VALUES(p_user,p_id,p_record,p_intent) ON CONFLICT DO NOTHING;
  SELECT * INTO v_attempt FROM public.upload_attempts WHERE user_id=p_user AND id=p_id FOR UPDATE;
  IF v_attempt.record_id<>p_record OR v_attempt.intent<>p_intent THEN RAISE EXCEPTION 'upload ID already used for a different request' USING ERRCODE='23514'; END IF;
  RETURN v_attempt.result;
END $$;

CREATE FUNCTION public.complete_upload(p_user UUID, p_id UUID, p_request JSONB, p_asset JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_attempt public.upload_attempts; v_asset public.assets; v_created BOOLEAN=false; v_owner UUID; v_result JSONB;
BEGIN
  SELECT * INTO v_attempt FROM public.upload_attempts WHERE user_id=p_user AND id=p_id FOR UPDATE;
  IF v_attempt.id IS NULL THEN RAISE EXCEPTION 'upload intent missing'; END IF;
  IF v_attempt.request IS NOT NULL AND v_attempt.request<>p_request THEN RAISE EXCEPTION 'upload request changed' USING ERRCODE='23514'; END IF;
  IF v_attempt.result IS NOT NULL THEN RETURN v_attempt.result; END IF;
  SELECT w.user_id INTO v_owner FROM public.records r JOIN public.works w ON w.id=r.work_id WHERE r.id=v_attempt.record_id FOR UPDATE OF r FOR SHARE OF w;
  IF v_owner IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'record not found' USING ERRCODE='42501'; END IF;
  IF p_request->>'role' NOT IN ('primary','supplement','cover') THEN RAISE EXCEPTION 'invalid role'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || (p_asset->>'checksum_sha256'),0));
  IF EXISTS (SELECT 1 FROM public.storage_deletions WHERE bucket=p_asset->>'bucket' AND path=p_asset->>'storage_path') THEN RAISE EXCEPTION 'asset being deleted'; END IF;
  SELECT * INTO v_asset FROM public.assets WHERE user_id=p_user AND checksum_sha256=p_asset->>'checksum_sha256' FOR UPDATE;
  IF v_asset.id IS NULL THEN
    INSERT INTO public.assets(user_id,bucket,storage_path,file_size,checksum_sha256,mime_type,file_format,processing_state)
    VALUES(p_user,p_asset->>'bucket',p_asset->>'storage_path',(p_asset->>'file_size')::bigint,p_asset->>'checksum_sha256',p_asset->>'mime_type',p_asset->>'file_format',p_asset->>'processing_state') RETURNING * INTO v_asset;
    v_created=true;
  ELSIF v_asset.deleting_at IS NOT NULL THEN RAISE EXCEPTION 'asset being deleted'; END IF;
  INSERT INTO public.record_assets(record_id,asset_id,role) VALUES(v_attempt.record_id,v_asset.id,p_request->>'role') ON CONFLICT DO NOTHING;
  IF p_request->>'role'<>'cover' THEN
    INSERT INTO public.jobs(user_id,job_type,payload,idempotency_key) VALUES(p_user,'extract_text',jsonb_build_object('asset_id',v_asset.id,'filename',coalesce(p_request->>'filename','')), 'extract_text:'||v_asset.id) ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  v_result=jsonb_build_object('status',CASE WHEN v_created THEN 'created' ELSE 'deduplicated' END,'asset',to_jsonb(v_asset));
  UPDATE public.upload_attempts SET request=p_request,result=v_result,updated_at=now() WHERE user_id=p_user AND id=p_id;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.begin_upload(UUID,UUID,UUID,JSONB), public.complete_upload(UUID,UUID,JSONB,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_upload(UUID,UUID,UUID,JSONB), public.complete_upload(UUID,UUID,JSONB,JSONB) TO service_role;

-- Qualify candidates BEFORE the limit, and retain claims until object deletion succeeds.
CREATE FUNCTION public.claim_storage_cleanup(p_limit INT DEFAULT 100)
RETURNS SETOF public.storage_deletions LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_asset public.assets;
BEGIN
  FOR v_asset IN SELECT a.* FROM public.assets a WHERE a.created_at<now()-interval '24 hours' AND a.deleting_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.record_assets ra WHERE ra.asset_id=a.id)
    AND NOT EXISTS(SELECT 1 FROM public.collections c WHERE c.cover_asset_id=a.id)
    ORDER BY a.created_at,a.id LIMIT greatest(1,least(p_limit,200)) FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.assets SET deleting_at=now() WHERE id=v_asset.id;
    INSERT INTO public.storage_deletions(bucket,path,asset_id) VALUES(v_asset.bucket,v_asset.storage_path,v_asset.id) ON CONFLICT DO NOTHING;
  END LOOP;
  INSERT INTO public.storage_deletions(bucket,path)
  SELECT o.bucket_id,o.name FROM storage.objects o
  WHERE o.bucket_id IN ('staging','documents','covers')
    AND o.created_at<now()-interval '24 hours'
    AND NOT EXISTS(SELECT 1 FROM public.assets a WHERE a.bucket=o.bucket_id AND a.storage_path=o.name)
    AND (o.bucket_id='staging' OR NOT EXISTS(SELECT 1 FROM public.upload_attempts u WHERE o.name LIKE u.user_id::text||'/'||u.id::text||'/%' AND u.updated_at>now()-interval '24 hours'))
  ORDER BY o.created_at,o.id LIMIT greatest(1,least(p_limit,200)) ON CONFLICT DO NOTHING;
  -- Deleted-user bytes qualify immediately, independent of folder count or insertion order.
  INSERT INTO public.storage_deletions(bucket,path)
  SELECT o.bucket_id,o.name FROM storage.objects o WHERE o.bucket_id IN ('staging','documents','covers')
    AND split_part(o.name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id::text=split_part(o.name,'/',1))
  ORDER BY o.created_at,o.id LIMIT greatest(1,least(p_limit,200)) ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT d.* FROM public.storage_deletions d ORDER BY d.created_at,d.bucket,d.path LIMIT greatest(1,least(p_limit,200));
END $$;
CREATE FUNCTION public.finish_storage_deletion(p_bucket TEXT,p_path TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_id UUID;
BEGIN
  SELECT asset_id INTO v_id FROM public.storage_deletions WHERE bucket=p_bucket AND path=p_path FOR UPDATE;
  IF v_id IS NOT NULL THEN DELETE FROM public.assets WHERE id=v_id AND deleting_at IS NOT NULL; END IF;
  DELETE FROM public.storage_deletions WHERE bucket=p_bucket AND path=p_path;
END $$;
REVOKE ALL ON FUNCTION public.claim_storage_cleanup(INT), public.finish_storage_deletion(TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_storage_cleanup(INT), public.finish_storage_deletion(TEXT,TEXT) TO service_role;

ALTER TABLE public.jobs ADD COLUMN claim_generation BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.jobs ADD COLUMN available_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE OR REPLACE FUNCTION public.claim_jobs(p_limit INT DEFAULT 1,p_lease INTERVAL DEFAULT interval '70 seconds')
RETURNS SETOF public.jobs LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_job public.jobs;
BEGIN
  SELECT j.* INTO v_job FROM public.jobs j WHERE j.attempts<j.max_attempts AND j.available_at<=now()
    AND (j.status='queued' OR (j.status='running' AND j.lease_expires_at<now()))
    ORDER BY CASE WHEN j.job_type='cleanup' THEN 0 WHEN j.job_type IN ('extract_text','process_cover','fetch_metadata') THEN 1 ELSE 2 END,
    (SELECT max(j2.started_at) FROM public.jobs j2 WHERE j2.user_id IS NOT DISTINCT FROM j.user_id) NULLS FIRST,j.created_at
    LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_job.id IS NULL THEN RETURN; END IF;
  UPDATE public.jobs SET status='running',attempts=attempts+1,claim_generation=claim_generation+1,started_at=now(),lease_expires_at=now()+least(p_lease,interval '2 minutes') WHERE id=v_job.id RETURNING * INTO v_job;
  IF v_job.job_type='extract_text' THEN UPDATE public.assets SET processing_state='processing',processing_error=NULL WHERE id=(v_job.payload->>'asset_id')::uuid AND user_id=v_job.user_id AND deleting_at IS NULL; END IF;
  RETURN NEXT v_job;
END $$;
CREATE FUNCTION public.finish_job(p_id UUID,p_generation BIGINT,p_result JSONB DEFAULT NULL,p_error TEXT DEFAULT NULL,p_continue JSONB DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_job public.jobs;
BEGIN
  SELECT * INTO v_job FROM public.jobs WHERE id=p_id AND claim_generation=p_generation AND status='running' AND lease_expires_at>now() FOR UPDATE;
  IF v_job.id IS NULL THEN RETURN false; END IF;
  IF p_error IS NOT NULL THEN
    UPDATE public.jobs SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END,available_at=now()+make_interval(secs=>least(300,5*(2^attempts)::int)),last_error=left(p_error,500),completed_at=CASE WHEN attempts>=max_attempts THEN now() END WHERE id=p_id;
    IF v_job.job_type='extract_text' AND v_job.attempts>=v_job.max_attempts THEN UPDATE public.assets SET processing_state='failed',processing_error='Text extraction failed. Retry from Activity.' WHERE id=(v_job.payload->>'asset_id')::uuid AND user_id=v_job.user_id; END IF;
  ELSIF p_continue IS NOT NULL THEN
    UPDATE public.jobs SET status='queued',payload=p_continue,attempts=0,result=p_result,available_at=now(),lease_expires_at=NULL WHERE id=p_id;
  ELSE
    UPDATE public.jobs SET status='succeeded',result=p_result,completed_at=now(),last_error=NULL WHERE id=p_id;
  END IF;
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.expire_stale_jobs() RETURNS INT LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_count INT;
BEGIN
  WITH expired AS (UPDATE public.jobs SET status='failed',completed_at=now(),last_error='worker lease expired on final attempt' WHERE status='running' AND lease_expires_at<now() AND attempts>=max_attempts RETURNING user_id,job_type,payload)
  UPDATE public.assets a SET processing_state='failed',processing_error='Text extraction failed. Retry from Activity.' FROM expired e WHERE e.job_type='extract_text' AND a.id=(e.payload->>'asset_id')::uuid AND a.user_id=e.user_id;
  GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.finish_job(UUID,BIGINT,JSONB,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_job(UUID,BIGINT,JSONB,TEXT,JSONB), public.claim_jobs(INT,INTERVAL), public.expire_stale_jobs() TO service_role;
