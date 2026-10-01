CREATE TABLE public.agent_actions(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 token_id UUID REFERENCES public.agent_tokens(id) ON DELETE SET NULL,request_id UUID NOT NULL,
 tool TEXT NOT NULL CHECK(tool IN('create_work_from_identifier','add_file_from_url','tag_work','add_to_collection')),
 arguments JSONB NOT NULL,preview JSONB,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','done')),
 expires_at TIMESTAMPTZ NOT NULL DEFAULT now()+interval '30 minutes',result JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(token_id,request_id)
);
CREATE INDEX agent_actions_owner ON public.agent_actions(user_id,created_at DESC);
ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_actions_owner_select ON public.agent_actions FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()) AND (SELECT auth.jwt()->>'textus_agent') IS DISTINCT FROM 'true');
-- No client INSERT/UPDATE/DELETE: exact arguments, approval and results change through narrow RPCs only.
REVOKE INSERT,UPDATE,DELETE ON public.agent_actions FROM anon,authenticated;

CREATE FUNCTION private.lock_write_token(p_token UUID) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id UUID;
BEGIN
 SELECT t.user_id INTO owner_id FROM public.agent_tokens t JOIN auth.users u ON u.id=t.user_id WHERE t.id=p_token AND t.scope='read_write' AND (t.expires_at IS NULL OR t.expires_at>now()) AND (u.banned_until IS NULL OR u.banned_until<=now()) FOR SHARE OF t,u;
 IF owner_id IS NULL THEN RAISE EXCEPTION 'live write token required' USING ERRCODE='42501'; END IF;
 RETURN owner_id;
END $$;
REVOKE ALL ON FUNCTION private.lock_write_token(UUID) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.request_agent_action(p_token UUID,p_request UUID,p_tool TEXT,p_arguments JSONB,p_preview JSONB DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SET search_path='' AS $$
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
 IF (SELECT count(*) FROM public.agent_actions WHERE user_id=owner_id AND status IN('pending','approved') AND expires_at>now())>=100 THEN RAISE EXCEPTION 'approval quota exceeded' USING ERRCODE='53300'; END IF;
 INSERT INTO public.agent_actions(user_id,token_id,request_id,tool,arguments,preview) VALUES(owner_id,p_token,p_request,p_tool,p_arguments,p_preview) RETURNING * INTO a;
 RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION public.request_agent_action(UUID,UUID,TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_agent_action(UUID,UUID,TEXT,JSONB,JSONB) TO service_role;

CREATE FUNCTION public.review_agent_action(p_action UUID,p_approve BOOLEAN) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR auth.jwt()->>'textus_agent'='true' THEN RAISE EXCEPTION 'owner session required' USING ERRCODE='42501'; END IF;
 UPDATE public.agent_actions SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END WHERE id=p_action AND user_id=auth.uid() AND status='pending' AND expires_at>now() AND token_id IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'pending action unavailable' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.review_agent_action(UUID,BOOLEAN) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_agent_action(UUID,BOOLEAN) TO authenticated;

CREATE FUNCTION private.lock_agent_action(p_action UUID,p_token UUID) RETURNS public.agent_actions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id UUID; a public.agent_actions;
BEGIN
 owner_id=private.lock_write_token(p_token);
 SELECT * INTO a FROM public.agent_actions WHERE id=p_action AND token_id=p_token AND user_id=owner_id FOR UPDATE;
 IF a.id IS NULL OR a.status NOT IN('approved','done') OR (a.status<>'done' AND a.expires_at<=now()) THEN RAISE EXCEPTION 'owner approval required' USING ERRCODE='42501'; END IF;
 RETURN a;
END $$;
REVOKE ALL ON FUNCTION private.lock_agent_action(UUID,UUID) FROM PUBLIC,anon,authenticated;

-- Preserve the catalog transaction; internal credentials cannot call its browser entry point.
ALTER FUNCTION public.create_catalog(UUID,JSONB) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.create_catalog(UUID,JSONB) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.create_catalog(p_request UUID,p_payload JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.jwt()->>'textus_agent'='true' THEN RAISE EXCEPTION 'owner session required' USING ERRCODE='42501'; END IF;
 RETURN private.create_catalog(p_request,p_payload);
END $$;
REVOKE ALL ON FUNCTION public.create_catalog(UUID,JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_catalog(UUID,JSONB) TO authenticated;

CREATE FUNCTION public.execute_agent_action(p_action UUID,p_token UUID) RETURNS JSONB LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a public.agent_actions; output JSONB; previous_claims TEXT; work_id UUID; target_id UUID;
BEGIN
 a=private.lock_agent_action(p_action,p_token);
 IF a.status='done' THEN RETURN a.result; END IF;
 IF a.tool='create_work_from_identifier' THEN
  previous_claims=current_setting('request.jwt.claims',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated','textus_agent',true)::text,true);
  output=private.create_catalog(a.id,a.preview||jsonb_build_object('expectedOwner',a.user_id));
  PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 ELSIF a.tool IN('tag_work','add_to_collection') THEN
  work_id=(a.arguments->>'workId')::uuid;
  PERFORM 1 FROM public.works WHERE id=work_id AND user_id=a.user_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'owned work required' USING ERRCODE='42501'; END IF;
  IF (SELECT count(*) FROM public.records WHERE public.records.work_id=execute_agent_action.work_id)>100 THEN RAISE EXCEPTION 'work exceeds 100-record action limit'; END IF;
  IF a.tool='tag_work' THEN
   target_id=(a.arguments->>'tagId')::uuid;
   PERFORM 1 FROM public.tags WHERE id=target_id AND user_id=a.user_id FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'owned tag required' USING ERRCODE='42501'; END IF;
   INSERT INTO public.record_tags(record_id,tag_id) SELECT id,target_id FROM public.records WHERE public.records.work_id=execute_agent_action.work_id ON CONFLICT DO NOTHING;
  ELSE
   target_id=(a.arguments->>'collectionId')::uuid;
   PERFORM 1 FROM public.collections WHERE id=target_id AND user_id=a.user_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'owned collection required' USING ERRCODE='42501'; END IF;
   INSERT INTO public.collection_records(collection_id,record_id,display_order) SELECT target_id,id,coalesce((SELECT max(display_order)+1 FROM public.collection_records WHERE collection_id=target_id),0)+row_number() OVER(ORDER BY created_at,id)::int-1 FROM public.records WHERE public.records.work_id=execute_agent_action.work_id ON CONFLICT DO NOTHING;
  END IF;
  output=jsonb_build_object('status','applied','workId',work_id);
 ELSE RAISE EXCEPTION 'URL actions require the upload finalizer'; END IF;
 UPDATE public.agent_actions SET status='done',result=output WHERE id=a.id;
 RETURN output;
END $$;
REVOKE ALL ON FUNCTION public.execute_agent_action(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_agent_action(UUID,UUID) TO service_role;

CREATE FUNCTION public.complete_agent_upload(p_action UUID,p_token UUID,p_request JSONB,p_asset JSONB) RETURNS JSONB LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a public.agent_actions; intent public.upload_attempts; output JSONB;
BEGIN
 a=private.lock_agent_action(p_action,p_token);
 IF a.status='done' THEN RETURN a.result; END IF;
 SELECT * INTO intent FROM public.upload_attempts WHERE user_id=a.user_id AND id=a.id;
 IF a.tool<>'add_file_from_url' OR intent.record_id::text IS DISTINCT FROM a.arguments->>'recordId' OR intent.intent->>'url' IS DISTINCT FROM a.arguments->>'url' OR p_request->>'role' IS DISTINCT FROM a.arguments->>'role' THEN RAISE EXCEPTION 'upload differs from approved arguments' USING ERRCODE='42501'; END IF;
 output=public.complete_upload(a.user_id,a.id,p_request,p_asset);
 UPDATE public.agent_actions SET status='done',result=output WHERE id=a.id;
 RETURN output;
END $$;
REVOKE ALL ON FUNCTION public.complete_agent_upload(UUID,UUID,JSONB,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_agent_upload(UUID,UUID,JSONB,JSONB) TO service_role;
