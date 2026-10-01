CREATE TABLE public.ai_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  generation_model TEXT CHECK(generation_model IS NULL OR length(generation_model) BETWEEN 1 AND 200),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_settings_owner ON public.ai_settings TO authenticated USING ((SELECT auth.uid())=user_id) WITH CHECK ((SELECT auth.uid())=user_id);
CREATE TRIGGER ai_settings_updated BEFORE UPDATE ON public.ai_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TABLE private.request_limits (
  key TEXT PRIMARY KEY,
  window_id BIGINT NOT NULL,
  count INT NOT NULL
);
CREATE TABLE private.ai_lease (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK(id),
  holder UUID,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT '-infinity'
);
INSERT INTO private.ai_lease(id) VALUES(true);
ALTER TABLE private.request_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ai_lease ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.request_limits,private.ai_lease FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.check_request_limit(p_key TEXT,p_limit INT DEFAULT 30,p_period INT DEFAULT 60)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_window_id BIGINT=floor(extract(epoch from clock_timestamp())/greatest(1,p_period)); v_count INT;
BEGIN
  IF length(p_key)>200 OR p_limit NOT BETWEEN 1 AND 1000 OR p_period NOT BETWEEN 1 AND 86400 THEN RETURN false; END IF;
  INSERT INTO private.request_limits(key,window_id,count) VALUES(p_key,v_window,1) ON CONFLICT(key) DO UPDATE
  SET window_id=excluded.window_id,count=CASE WHEN request_limits.window_id=excluded.window_id THEN request_limits.count+1 ELSE 1 END RETURNING count INTO v_count;
  RETURN v_count<=p_limit;
END $$;
CREATE FUNCTION public.acquire_ai_lease() RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id UUID=gen_random_uuid(); v_acquired UUID;
BEGIN
  UPDATE private.ai_lease SET holder=v_id,expires_at=clock_timestamp()+interval '55 seconds' WHERE id AND expires_at<clock_timestamp() RETURNING holder INTO v_acquired;
  RETURN v_acquired;
END $$;
CREATE FUNCTION public.release_ai_lease(p_holder UUID) RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  UPDATE private.ai_lease SET holder=NULL,expires_at='-infinity' WHERE holder=p_holder;
$$;
REVOKE ALL ON FUNCTION public.check_request_limit(TEXT,INT,INT),public.acquire_ai_lease(),public.release_ai_lease(UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.check_request_limit(TEXT,INT,INT),public.acquire_ai_lease(),public.release_ai_lease(UUID) TO service_role;
CREATE FUNCTION public.active_job_count() RETURNS INT LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT count(*)::int FROM public.jobs WHERE status IN ('queued','running');
$$;
REVOKE ALL ON FUNCTION public.active_job_count() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.active_job_count() TO authenticated,service_role;
