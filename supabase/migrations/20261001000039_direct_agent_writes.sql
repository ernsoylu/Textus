-- A read_write token is the owner's decision to let that agent write; asking the owner to approve each action
-- as well made the scope meaningless. Requests from a live read_write token are recorded already approved,
-- so the same call executes them. Token checks, request binding/replay and the atomic writes are unchanged;
-- every change is logged in book history under the agent's name, and revoking the token stops it at once.
CREATE OR REPLACE FUNCTION public.request_agent_action(p_token UUID,p_request UUID,p_tool TEXT,p_arguments JSONB,p_preview JSONB DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id UUID; a public.agent_actions;
BEGIN
 owner_id=private.lock_write_token(p_token);
 IF p_tool NOT IN('create_work_from_identifier','add_file_from_url','tag_work','add_to_collection') OR jsonb_typeof(p_arguments)<>'object' OR octet_length(p_arguments::text)>8192 OR octet_length(coalesce(p_preview,'{}')::text)>32768 THEN RAISE EXCEPTION 'invalid action'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||':agent-actions',0));
 SELECT * INTO a FROM public.agent_actions WHERE token_id=p_token AND request_id=p_request FOR UPDATE;
 IF a.id IS NOT NULL THEN
  IF a.tool<>p_tool OR a.arguments<>p_arguments THEN RAISE EXCEPTION 'request bound to different arguments' USING ERRCODE='23514'; END IF;
  RETURN to_jsonb(a);
 END IF;
 IF (SELECT count(*) FROM public.agent_actions WHERE user_id=owner_id AND status IN('pending','approved') AND expires_at>now())>=100 THEN RAISE EXCEPTION 'agent request quota exceeded' USING ERRCODE='53300'; END IF;
 INSERT INTO public.agent_actions(user_id,token_id,request_id,tool,arguments,preview,status) VALUES(owner_id,p_token,p_request,p_tool,p_arguments,p_preview,'approved') RETURNING * INTO a;
 RETURN to_jsonb(a);
END $$;
