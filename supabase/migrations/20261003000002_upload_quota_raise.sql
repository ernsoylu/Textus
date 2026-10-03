-- app102 runs these limits (set on the server, outside git): 50 GB of stored plus pending upload bytes and 2000
-- queued/running jobs per owner. Passage indexing keeps its own 500-job quota.
CREATE OR REPLACE FUNCTION public.begin_upload(p_user UUID, p_id UUID, p_record UUID, p_intent JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_attempt public.upload_attempts;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.records r JOIN public.works w ON w.id=r.work_id WHERE r.id=p_record AND w.user_id=p_user) THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||':upload-quota',0));
  IF NOT EXISTS(SELECT 1 FROM public.upload_attempts WHERE user_id=p_user AND id=p_id) THEN
    IF (SELECT coalesce(sum(file_size),0) FROM public.assets WHERE user_id=p_user)
       +(SELECT coalesce(sum(coalesce((intent->>'size')::bigint,524288000)),0) FROM public.upload_attempts WHERE user_id=p_user AND result IS NULL AND updated_at>now()-interval '24 hours')
       +coalesce((p_intent->>'size')::bigint,524288000)>53687091200
       OR (SELECT count(*) FROM public.jobs WHERE user_id=p_user AND status IN ('queued','running'))>=2000 THEN
      RAISE EXCEPTION 'library resource quota exceeded' USING ERRCODE='53300';
    END IF;
  END IF;
  INSERT INTO public.upload_attempts(user_id,id,record_id,intent) VALUES(p_user,p_id,p_record,p_intent) ON CONFLICT DO NOTHING;
  SELECT * INTO v_attempt FROM public.upload_attempts WHERE user_id=p_user AND id=p_id FOR UPDATE;
  IF v_attempt.record_id<>p_record OR v_attempt.intent<>p_intent THEN RAISE EXCEPTION 'upload ID already used for a different request' USING ERRCODE='23514'; END IF;
  RETURN v_attempt.result;
END $$;

