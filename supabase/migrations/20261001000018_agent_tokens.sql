CREATE TABLE public.agent_tokens(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),token_hash TEXT NOT NULL UNIQUE CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 token_prefix TEXT NOT NULL CHECK(token_prefix ~ '^tx_[0-9a-f]{6}$'),scope TEXT NOT NULL DEFAULT 'read' CHECK(scope IN('read','read_write')),
 expires_at TIMESTAMPTZ,last_used_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX agent_tokens_owner ON public.agent_tokens(user_id);
ALTER TABLE public.agent_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tokens_owner_select ON public.agent_tokens FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()) AND (SELECT auth.jwt()->>'textus_agent') IS DISTINCT FROM 'true');
CREATE POLICY tokens_owner_insert ON public.agent_tokens FOR INSERT TO authenticated WITH CHECK(user_id=(SELECT auth.uid()) AND (SELECT auth.jwt()->>'textus_agent') IS DISTINCT FROM 'true');
CREATE POLICY tokens_owner_delete ON public.agent_tokens FOR DELETE TO authenticated USING(user_id=(SELECT auth.uid()) AND (SELECT auth.jwt()->>'textus_agent') IS DISTINCT FROM 'true');
-- No UPDATE policy: token scope/expiry cannot be broadened after issuance.
CREATE FUNCTION private.use_agent_token(p_hash TEXT) RETURNS TABLE(token_id UUID,user_id UUID,scope TEXT) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.agent_tokens;
BEGIN
 SELECT a.* INTO t FROM public.agent_tokens a JOIN auth.users u ON u.id=a.user_id WHERE a.token_hash=p_hash AND (a.expires_at IS NULL OR a.expires_at>now()) AND (u.banned_until IS NULL OR u.banned_until<=now());
 IF t.id IS NULL THEN RETURN; END IF;
 UPDATE public.agent_tokens SET last_used_at=now() WHERE id=t.id AND (last_used_at IS NULL OR last_used_at<now()-interval '1 minute');
 RETURN QUERY SELECT t.id,t.user_id,t.scope;
END $$;
REVOKE ALL ON FUNCTION private.use_agent_token(TEXT) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.use_agent_token(p_hash TEXT) RETURNS TABLE(token_id UUID,user_id UUID,scope TEXT) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$SELECT * FROM private.use_agent_token(p_hash)$$;
REVOKE ALL ON FUNCTION public.use_agent_token(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.use_agent_token(TEXT) TO service_role;
