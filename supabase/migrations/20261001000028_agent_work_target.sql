-- Qualify record columns and use a distinct local target name in the approved transaction.
CREATE OR REPLACE FUNCTION public.execute_agent_action(p_action UUID,p_token UUID) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.agent_actions; output JSONB; previous_claims TEXT; v_work_id UUID; target_id UUID;
BEGIN
 a=private.lock_agent_action(p_action,p_token);
 IF a.status='done' THEN RETURN a.result; END IF;
 IF a.tool='create_work_from_identifier' THEN
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
 ELSE RAISE EXCEPTION 'URL actions require the upload finalizer'; END IF;
 UPDATE public.agent_actions SET status='done',result=output WHERE id=a.id;
 RETURN output;
END $$;
REVOKE ALL ON FUNCTION public.execute_agent_action(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.execute_agent_action(UUID,UUID) TO service_role;

