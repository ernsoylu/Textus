-- Service-only housekeeping. Preserve durable replay results while a token can authenticate.
ALTER TABLE private.request_limits ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE OR REPLACE FUNCTION public.check_request_limit(p_key TEXT,p_limit INT DEFAULT 30,p_period INT DEFAULT 60)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_window_id BIGINT=floor(extract(epoch from clock_timestamp())/greatest(1,p_period)); v_count INT;
BEGIN
 IF length(p_key)>200 OR p_limit NOT BETWEEN 1 AND 1000 OR p_period NOT BETWEEN 1 AND 86400 THEN RETURN false; END IF;
 INSERT INTO private.request_limits(key,window_id,count,updated_at) VALUES(p_key,v_window_id,1,now()) ON CONFLICT(key) DO UPDATE
 SET window_id=excluded.window_id,count=CASE WHEN request_limits.window_id=excluded.window_id THEN request_limits.count+1 ELSE 1 END,updated_at=now() RETURNING count INTO v_count;
 RETURN v_count<=p_limit;
END $$;
CREATE FUNCTION public.prune_operational_history() RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 DELETE FROM private.request_limits WHERE updated_at<now()-interval '2 days';
 UPDATE private.ai_lease SET holder=NULL WHERE expires_at<now();
 DELETE FROM public.jobs WHERE status IN('succeeded','failed','cancelled') AND coalesce(completed_at,created_at)<now()-interval '30 days';
 DELETE FROM public.agent_actions a WHERE a.created_at<now()-interval '30 days' AND
   (a.token_id IS NULL OR EXISTS(SELECT 1 FROM public.agent_tokens t WHERE t.id=a.token_id AND t.expires_at<now()-interval '30 days'));
END $$;
REVOKE ALL ON FUNCTION public.prune_operational_history() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prune_operational_history() TO service_role;
