CREATE FUNCTION private.limit_agent_tokens() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.role()='authenticated' AND (NEW.user_id IS DISTINCT FROM auth.uid() OR auth.jwt()->>'textus_agent'='true') THEN
  RAISE EXCEPTION 'Token ownership required' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('agent-tokens:'||NEW.user_id::text,0));
 IF (SELECT count(*) FROM public.agent_tokens WHERE user_id=NEW.user_id)>=100 THEN
  RAISE EXCEPTION 'Revoke an existing token before creating another' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.limit_agent_tokens() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER agent_token_limit BEFORE INSERT ON public.agent_tokens FOR EACH ROW EXECUTE FUNCTION private.limit_agent_tokens();
