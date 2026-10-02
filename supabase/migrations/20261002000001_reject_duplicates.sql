-- FR-CAT-5/7: the server, not the SPA, refuses a second work for the same file or the same identifier, so every
-- path (upload page, add via link, autofill, import, MCP) is covered. Similar title + author stays a warning
-- (find_duplicate_works), since editions and volumes look alike. merge_works() folds existing duplicates together.

-- An identifier (except ISSN, which names a serial) belongs to one work per user. Other records of the same work may
-- share it. A trigger rather than a unique index because identifiers carry neither user_id nor work_id.
-- PT409 makes PostgREST answer 409; DETAIL carries the work that already has the identifier.
CREATE FUNCTION private.reject_duplicate_identifier() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID; v_work UUID; v_other UUID;
BEGIN
  IF NEW.scheme='issn' THEN RETURN NEW; END IF;
  SELECT w.user_id,w.id INTO v_user,v_work FROM public.records r JOIN public.works w ON w.id=r.work_id WHERE r.id=NEW.record_id;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text||':identifier:'||NEW.scheme||':'||NEW.normalized_value,0));
  SELECT r.work_id INTO v_other FROM public.identifiers i JOIN public.records r ON r.id=i.record_id JOIN public.works w ON w.id=r.work_id
  WHERE i.scheme=NEW.scheme AND i.normalized_value=NEW.normalized_value AND w.user_id=v_user AND r.work_id<>v_work AND i.id IS DISTINCT FROM NEW.id
  LIMIT 1;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate_work' USING ERRCODE='PT409', DETAIL=v_other::text, HINT='This identifier already belongs to another work in your library.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.reject_duplicate_identifier() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER identifiers_one_work BEFORE INSERT OR UPDATE OF record_id,scheme,normalized_value ON public.identifiers
FOR EACH ROW EXECUTE FUNCTION private.reject_duplicate_identifier();

-- As in 20261001000002, plus: bytes already attached (not as a cover) to another work are not linked again. The
-- result is {status:'duplicate', workId}, stored on the attempt so retries give the same answer.
CREATE OR REPLACE FUNCTION public.complete_upload(p_user UUID, p_id UUID, p_request JSONB, p_asset JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_attempt public.upload_attempts; v_asset public.assets; v_created BOOLEAN=false; v_owner UUID; v_work UUID; v_other UUID; v_result JSONB;
BEGIN
  SELECT * INTO v_attempt FROM public.upload_attempts WHERE user_id=p_user AND id=p_id FOR UPDATE;
  IF v_attempt.id IS NULL THEN RAISE EXCEPTION 'upload intent missing'; END IF;
  IF v_attempt.request IS NOT NULL AND v_attempt.request<>p_request THEN RAISE EXCEPTION 'upload request changed' USING ERRCODE='23514'; END IF;
  IF v_attempt.result IS NOT NULL THEN RETURN v_attempt.result; END IF;
  SELECT w.user_id,w.id INTO v_owner,v_work FROM public.records r JOIN public.works w ON w.id=r.work_id WHERE r.id=v_attempt.record_id FOR UPDATE OF r FOR SHARE OF w;
  IF v_owner IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'record not found' USING ERRCODE='42501'; END IF;
  IF p_request->>'role' NOT IN ('primary','supplement','cover') THEN RAISE EXCEPTION 'invalid role'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || (p_asset->>'checksum_sha256'),0));
  IF EXISTS (SELECT 1 FROM public.storage_deletions WHERE bucket=p_asset->>'bucket' AND path=p_asset->>'storage_path') THEN RAISE EXCEPTION 'asset being deleted'; END IF;
  SELECT * INTO v_asset FROM public.assets WHERE user_id=p_user AND checksum_sha256=p_asset->>'checksum_sha256' FOR UPDATE;
  IF v_asset.id IS NULL THEN
    INSERT INTO public.assets(user_id,bucket,storage_path,file_size,checksum_sha256,mime_type,file_format,processing_state)
    VALUES(p_user,p_asset->>'bucket',p_asset->>'storage_path',(p_asset->>'file_size')::bigint,p_asset->>'checksum_sha256',p_asset->>'mime_type',p_asset->>'file_format',p_asset->>'processing_state') RETURNING * INTO v_asset;
    v_created=true;
  ELSIF v_asset.deleting_at IS NOT NULL THEN RAISE EXCEPTION 'asset being deleted';
  ELSIF p_request->>'role'<>'cover' THEN
    SELECT r.work_id INTO v_other FROM public.record_assets ra JOIN public.records r ON r.id=ra.record_id
    WHERE ra.asset_id=v_asset.id AND ra.role NOT IN ('cover','thumbnail') AND r.work_id<>v_work LIMIT 1;
  END IF;
  IF v_other IS NOT NULL THEN
    v_result=jsonb_build_object('status','duplicate','workId',v_other,'asset',to_jsonb(v_asset));
  ELSE
    INSERT INTO public.record_assets(record_id,asset_id,role) VALUES(v_attempt.record_id,v_asset.id,p_request->>'role') ON CONFLICT DO NOTHING;
    IF p_request->>'role'<>'cover' THEN
      INSERT INTO public.jobs(user_id,job_type,payload,idempotency_key) VALUES(p_user,'extract_text',jsonb_build_object('asset_id',v_asset.id,'filename',coalesce(p_request->>'filename','')), 'extract_text:'||v_asset.id) ON CONFLICT(idempotency_key) DO NOTHING;
    END IF;
    v_result=jsonb_build_object('status',CASE WHEN v_created THEN 'created' ELSE 'deduplicated' END,'asset',to_jsonb(v_asset));
  END IF;
  UPDATE public.upload_attempts SET request=p_request,result=v_result,updated_at=now() WHERE user_id=p_user AND id=p_id;
  RETURN v_result;
END $$;

-- Moves everything record-scoped from p_from onto p_to (same work), then removes p_from.
CREATE FUNCTION private.fold_record(p_from UUID, p_to UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  UPDATE public.records SET container_record_id=p_to WHERE container_record_id=p_from;
  -- Every file is kept; a second cover or thumbnail is not.
  INSERT INTO public.record_assets(record_id,asset_id,role)
  SELECT p_to,ra.asset_id,ra.role FROM public.record_assets ra WHERE ra.record_id=p_from
    AND NOT (ra.role IN ('cover','thumbnail') AND EXISTS (SELECT 1 FROM public.record_assets k WHERE k.record_id=p_to AND k.role=ra.role))
  ON CONFLICT DO NOTHING;
  UPDATE public.identifiers i SET record_id=p_to WHERE i.record_id=p_from
    AND NOT EXISTS (SELECT 1 FROM public.identifiers k WHERE k.record_id=p_to AND k.scheme=i.scheme AND k.normalized_value=i.normalized_value);
  IF NOT EXISTS (SELECT 1 FROM public.record_contributors WHERE record_id=p_to) THEN
    UPDATE public.record_contributors SET record_id=p_to WHERE record_id=p_from;
  END IF;
  INSERT INTO public.record_tags(record_id,tag_id) SELECT p_to,tag_id FROM public.record_tags WHERE record_id=p_from ON CONFLICT DO NOTHING;
  INSERT INTO public.collection_records(collection_id,record_id,display_order,added_at)
  SELECT collection_id,p_to,display_order,added_at FROM public.collection_records WHERE record_id=p_from ON CONFLICT DO NOTHING;
  UPDATE public.annotations SET record_id=p_to WHERE record_id=p_from;
  -- One reading state per user and record: the most recently updated one wins.
  DELETE FROM public.reading_states s WHERE s.record_id IN (p_from,p_to) AND EXISTS (
    SELECT 1 FROM public.reading_states o WHERE o.user_id=s.user_id AND o.record_id IN (p_from,p_to) AND o.id<>s.id AND (o.updated_at,o.id)>(s.updated_at,s.id));
  UPDATE public.reading_states SET record_id=p_to WHERE record_id=p_from;
  DELETE FROM public.records WHERE id=p_from;
END $$;
REVOKE ALL ON FUNCTION private.fold_record(UUID,UUID) FROM PUBLIC,anon,authenticated;

-- Owner-only (never agents): p_drop's records join p_keep. A record that shares a file or a non-ISSN identifier with
-- one of p_keep's records is folded into it (or every record into p_into, when given); others stay as editions.
-- Empty work fields are filled from p_drop, which is then deleted. Book history logs the moves and the deletion.
CREATE FUNCTION public.merge_works(p_keep UUID, p_drop UUID, p_into UUID DEFAULT NULL) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user UUID=auth.uid(); v_drop public.works; v_originals UUID[]; v_record UUID; v_twin UUID;
BEGIN
  IF v_user IS NULL OR auth.jwt()->>'textus_agent'='true' THEN RAISE EXCEPTION 'owner session required' USING ERRCODE='42501'; END IF;
  IF p_keep=p_drop THEN RAISE EXCEPTION 'cannot merge a work into itself' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.works WHERE id IN (p_keep,p_drop) AND user_id=v_user ORDER BY id FOR UPDATE;
  SELECT * INTO v_drop FROM public.works WHERE id=p_drop AND user_id=v_user;
  IF v_drop.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.works WHERE id=p_keep AND user_id=v_user) THEN RAISE EXCEPTION 'work not found' USING ERRCODE='42501'; END IF;
  IF p_into IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.records WHERE id=p_into AND work_id=p_keep) THEN RAISE EXCEPTION 'record not found' USING ERRCODE='42501'; END IF;
  SELECT coalesce(array_agg(id),'{}') INTO v_originals FROM public.records WHERE work_id=p_keep;
  UPDATE public.records SET work_id=p_keep WHERE work_id=p_drop;
  FOR v_record IN SELECT id FROM public.records WHERE work_id=p_keep AND id<>ALL(v_originals) ORDER BY id LOOP
    v_twin=coalesce(p_into,(SELECT k.id FROM unnest(v_originals) k(id) WHERE
      EXISTS (SELECT 1 FROM public.record_assets a JOIN public.record_assets b ON b.asset_id=a.asset_id
              WHERE a.record_id=v_record AND b.record_id=k.id AND a.role NOT IN ('cover','thumbnail') AND b.role NOT IN ('cover','thumbnail'))
      OR EXISTS (SELECT 1 FROM public.identifiers a JOIN public.identifiers b ON b.scheme=a.scheme AND b.normalized_value=a.normalized_value
              WHERE a.record_id=v_record AND b.record_id=k.id AND a.scheme<>'issn')
      ORDER BY k.id LIMIT 1));
    IF v_twin IS NOT NULL THEN PERFORM private.fold_record(v_record,v_twin); END IF;
  END LOOP;
  UPDATE public.works SET subtitle=coalesce(subtitle,v_drop.subtitle),abstract=coalesce(abstract,v_drop.abstract),user_rating=coalesce(user_rating,v_drop.user_rating) WHERE id=p_keep;
  DELETE FROM public.works WHERE id=p_drop;
  RETURN p_keep;
END $$;
REVOKE ALL ON FUNCTION public.merge_works(UUID,UUID,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.merge_works(UUID,UUID,UUID) TO authenticated;
