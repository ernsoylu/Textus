-- MCP write tools for files the agent holds locally (§8.8): create_work catalogs a work from owner-supplied title and
-- credits (no identifier or provider data), and upload_file stages bytes through a signed upload URL and finishes
-- through the same complete_upload pipeline as the browser (§9.1). Both stay bound to token/request/arguments.
ALTER TABLE public.agent_actions DROP CONSTRAINT agent_actions_tool_check;
ALTER TABLE public.agent_actions ADD CONSTRAINT agent_actions_tool_check
  CHECK (tool IN ('create_work_from_identifier','create_work','add_file_from_url','upload_file','tag_work','add_to_collection'));

CREATE OR REPLACE FUNCTION public.request_agent_action(p_token UUID,p_request UUID,p_tool TEXT,p_arguments JSONB,p_preview JSONB DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner_id UUID; a public.agent_actions;
BEGIN
 owner_id=private.lock_write_token(p_token);
 IF p_tool NOT IN('create_work_from_identifier','create_work','add_file_from_url','upload_file','tag_work','add_to_collection') OR jsonb_typeof(p_arguments)<>'object' OR octet_length(p_arguments::text)>8192 OR octet_length(coalesce(p_preview,'{}')::text)>32768 THEN RAISE EXCEPTION 'invalid action'; END IF;
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

CREATE OR REPLACE FUNCTION public.execute_agent_action(p_action UUID,p_token UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.agent_actions; output JSONB; previous_claims TEXT; v_work_id UUID; target_id UUID;
BEGIN
 a=private.lock_agent_action(p_action,p_token);
 IF a.status='done' THEN RETURN a.result; END IF;
 IF a.tool IN('create_work_from_identifier','create_work') THEN
  previous_claims=current_setting('request.jwt.claims',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a.user_id,'role','authenticated','textus_agent',true)::text,true);
  output=private.create_catalog(a.id,a.preview||jsonb_build_object('expectedOwner',a.user_id));
  PERFORM set_config('request.jwt.claims',coalesce(previous_claims,''),true);
 ELSIF a.tool IN('tag_work','add_to_collection') THEN
  v_work_id=(a.arguments->>'workId')::uuid;
  PERFORM 1 FROM public.works WHERE id=v_work_id AND user_id=a.user_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'owned work required' USING ERRCODE='42501'; END IF;
  IF (SELECT count(*) FROM public.records WHERE public.records.work_id=v_work_id)>100 THEN RAISE EXCEPTION 'work exceeds 100-record action limit'; END IF;
  IF a.tool='tag_work' THEN
   target_id=(a.arguments->>'tagId')::uuid;
   PERFORM 1 FROM public.tags WHERE id=target_id AND user_id=a.user_id FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'owned tag required' USING ERRCODE='42501'; END IF;
   INSERT INTO public.record_tags(record_id,tag_id) SELECT id,target_id FROM public.records WHERE public.records.work_id=v_work_id ON CONFLICT DO NOTHING;
  ELSE
   target_id=(a.arguments->>'collectionId')::uuid;
   PERFORM 1 FROM public.collections WHERE id=target_id AND user_id=a.user_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'owned collection required' USING ERRCODE='42501'; END IF;
   INSERT INTO public.collection_records(collection_id,record_id,display_order) SELECT target_id,id,coalesce((SELECT max(display_order)+1 FROM public.collection_records WHERE collection_id=target_id),0)+row_number() OVER(ORDER BY created_at,id)::int-1 FROM public.records WHERE public.records.work_id=v_work_id ON CONFLICT DO NOTHING;
  END IF;
  output=jsonb_build_object('status','applied','workId',v_work_id);
 ELSE RAISE EXCEPTION 'file actions require the upload finalizer'; END IF;
 UPDATE public.agent_actions SET status='done',result=output WHERE id=a.id;
 RETURN output;
END $$;

-- The staged upload must match the action's record, role and (by kind) URL or filename + size.
CREATE OR REPLACE FUNCTION public.complete_agent_upload(p_action UUID,p_token UUID,p_request JSONB,p_asset JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.agent_actions; intent public.upload_attempts; output JSONB;
BEGIN
 a=private.lock_agent_action(p_action,p_token);
 IF a.status='done' THEN RETURN a.result; END IF;
 SELECT * INTO intent FROM public.upload_attempts WHERE user_id=a.user_id AND id=a.id;
 IF a.tool NOT IN('add_file_from_url','upload_file') OR intent.record_id::text IS DISTINCT FROM a.arguments->>'recordId' OR p_request->>'role' IS DISTINCT FROM a.arguments->>'role'
  OR (a.tool='add_file_from_url' AND intent.intent->>'url' IS DISTINCT FROM a.arguments->>'url')
  OR (a.tool='upload_file' AND (intent.intent->>'filename' IS DISTINCT FROM a.arguments->>'filename' OR intent.intent->>'size' IS DISTINCT FROM a.arguments->>'size' OR p_request->>'filename' IS DISTINCT FROM a.arguments->>'filename'))
 THEN RAISE EXCEPTION 'upload differs from approved arguments' USING ERRCODE='42501'; END IF;
 output=public.complete_upload(a.user_id,a.id,p_request,p_asset);
 UPDATE public.agent_actions SET status='done',result=output WHERE id=a.id;
 RETURN output;
END $$;

CREATE OR REPLACE FUNCTION private.history_agent_actions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE work UUID; rec UUID; agent TEXT; label TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NULL; END IF;
  -- read_write tokens are approved on request (migration 20261001000039); only the completed change is history.
  IF TG_OP = 'INSERT' AND NEW.status = 'approved' THEN RETURN NULL; END IF;
  BEGIN rec := nullif(NEW.arguments->>'recordId', '')::uuid; work := coalesce(nullif(NEW.arguments->>'workId', '')::uuid, nullif(NEW.result->>'workId', '')::uuid); EXCEPTION WHEN others THEN RETURN NULL; END;
  IF work IS NULL AND rec IS NOT NULL THEN SELECT r.work_id INTO work FROM public.records r WHERE r.id = rec; END IF;
  IF work IS NULL OR NOT EXISTS (SELECT 1 FROM public.works w WHERE w.id = work AND w.user_id = NEW.user_id) THEN RETURN NULL; END IF;
  agent := coalesce((SELECT t.name FROM public.agent_tokens t WHERE t.id = NEW.token_id), 'agent');
  label := CASE NEW.tool WHEN 'tag_work' THEN 'tag this book' WHEN 'add_to_collection' THEN 'add this book to a collection'
    WHEN 'add_file_from_url' THEN 'add a file from ' || coalesce(NEW.arguments->>'url', 'a URL')
    WHEN 'upload_file' THEN 'upload ' || coalesce(NEW.arguments->>'filename', 'a file')
    WHEN 'create_work' THEN 'create this book' ELSE 'create this book from an identifier' END;
  PERFORM private.log_work_event(NEW.user_id, work, rec, NULL, 'agent.' || NEW.status,
    CASE NEW.status WHEN 'pending' THEN agent || ' proposed to ' || label WHEN 'approved' THEN 'Approved ' || agent || ' to ' || label
      WHEN 'rejected' THEN 'Rejected ' || agent || '’s proposal to ' || label ELSE agent || ' carried out a request to ' || label END,
    jsonb_build_object('proposal', jsonb_build_object('new', jsonb_build_object('tool', NEW.tool, 'arguments', NEW.arguments, 'status', NEW.status))),
    CASE WHEN NEW.status IN ('approved','rejected') THEN 'user' ELSE 'agent' END, CASE WHEN NEW.status IN ('approved','rejected') THEN NULL ELSE agent END);
  RETURN NULL;
END $$;
