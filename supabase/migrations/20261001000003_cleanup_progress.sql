-- Failed objects must not block later candidates; retry claims with bounded backoff.
ALTER TABLE public.storage_deletions ADD COLUMN available_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.storage_deletions ADD COLUMN attempts INT NOT NULL DEFAULT 0;
CREATE INDEX storage_deletions_available ON public.storage_deletions(available_at,created_at);
CREATE FUNCTION public.retry_storage_deletion(p_bucket TEXT,p_path TEXT) RETURNS VOID LANGUAGE sql SET search_path='' AS $$
  UPDATE public.storage_deletions SET attempts=attempts+1,available_at=now()+make_interval(secs=>least(3600,30*(2^least(attempts,6))::int)) WHERE bucket=p_bucket AND path=p_path;
$$;
REVOKE ALL ON FUNCTION public.retry_storage_deletion(TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retry_storage_deletion(TEXT,TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_storage_cleanup(p_limit INT DEFAULT 100)
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
    AND NOT EXISTS(SELECT 1 FROM public.storage_deletions d WHERE d.bucket=o.bucket_id AND d.path=o.name)
    AND NOT EXISTS(SELECT 1 FROM public.assets a WHERE a.bucket=o.bucket_id AND a.storage_path=o.name)
    AND (o.bucket_id='staging' OR NOT EXISTS(SELECT 1 FROM public.upload_attempts u WHERE o.name LIKE u.user_id::text||'/'||u.id::text||'/%' AND u.updated_at>now()-interval '24 hours'))
  ORDER BY o.created_at,o.id LIMIT greatest(1,least(p_limit,200)) ON CONFLICT DO NOTHING;
  -- Deleted-user bytes qualify immediately, independent of folder count or insertion order.
  INSERT INTO public.storage_deletions(bucket,path)
  SELECT o.bucket_id,o.name FROM storage.objects o WHERE o.bucket_id IN ('staging','documents','covers')
    AND NOT EXISTS(SELECT 1 FROM public.storage_deletions d WHERE d.bucket=o.bucket_id AND d.path=o.name)
    AND split_part(o.name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id::text=split_part(o.name,'/',1))
  ORDER BY o.created_at,o.id LIMIT greatest(1,least(p_limit,200)) ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT d.* FROM public.storage_deletions d WHERE d.available_at<=now() ORDER BY d.created_at,d.bucket,d.path LIMIT greatest(1,least(p_limit,200));
END $$;
