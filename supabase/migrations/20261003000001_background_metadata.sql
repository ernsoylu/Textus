-- Provider imports belong to the worker, not to a mounted book page. AI stays review-only.
CREATE OR REPLACE FUNCTION public.apply_background_metadata(p_user UUID,p_record UUID,p_payload JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.works; r public.records; existing_work UUID; existing_record UUID;
 wp JSONB; rp JSONB; mp JSONB; person JSONB; authority RECORD; contributor UUID; known UUID;
 credits JSONB='[]'; positions JSONB='{}'; role TEXT; position INT; filename_title BOOLEAN;
 resolved TEXT;
 original_claims TEXT=current_setting('request.jwt.claims',true);
BEGIN
 IF p_payload->'record'->>'metadata_source' LIKE 'llm:%' OR coalesce(p_payload->'record'->>'metadata_source','')='' THEN RAISE EXCEPTION 'provider metadata required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||':catalog',0));
 SELECT x.* INTO r FROM public.records x JOIN public.works y ON y.id=x.work_id WHERE x.id=p_record AND y.user_id=p_user;
 IF r.id IS NULL THEN RETURN false; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','service_role')::text,true);
 -- The same ISBN/DOI upload fold used by the existing automatic importer.
 SELECT y.id,x.id INTO existing_work,existing_record FROM public.identifiers i JOIN public.records x ON x.id=i.record_id JOIN public.works y ON y.id=x.work_id
 WHERE y.user_id=p_user AND x.work_id<>r.work_id AND i.scheme=p_payload->'identifiers'->0->>'scheme' AND i.normalized_value=p_payload->'identifiers'->0->>'value' LIMIT 1;
 IF existing_work IS NOT NULL THEN
  PERFORM public.merge_works(existing_work,r.work_id,existing_record);
  PERFORM set_config('request.jwt.claims',coalesce(original_claims,''),true);
  RETURN false;
 END IF;
 SELECT * INTO w FROM public.works WHERE id=r.work_id AND user_id=p_user FOR UPDATE;
 SELECT * INTO r FROM public.records WHERE id=p_record FOR UPDATE;
 -- Merge the suggestion against the live row so a concurrent edit cannot lose its locks.
 IF p_payload ? 'suggestion' THEN
  UPDATE public.records SET metadata=jsonb_set(coalesce(metadata,'{}'),'{lookup_suggestions}',coalesce(metadata->'lookup_suggestions','{}')||
   jsonb_build_object((p_payload->'identifiers'->0->>'scheme')||':'||(p_payload->'identifiers'->0->>'value'),jsonb_build_object('data',p_payload->'suggestion','fetched_at',now()))) WHERE id=r.id;
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.record_assets ra JOIN public.assets a ON a.id=ra.asset_id
  WHERE ra.record_id=r.id AND lower(regexp_replace(regexp_replace(regexp_replace(a.metadata->>'filename','\.[^.]+$',''),'[._]+',' ','g'),'\s+',' ','g'))=
   lower(regexp_replace(regexp_replace(regexp_replace(w.title,'\.[^.]+$',''),'[._]+',' ','g'),'\s+',' ','g'))) INTO filename_title;
 IF r.metadata_fetched_at IS NOT NULL AND NOT filename_title THEN
  PERFORM set_config('request.jwt.claims',coalesce(original_claims,''),true); RETURN false;
 END IF;
 IF filename_title THEN UPDATE public.works SET metadata=jsonb_set(coalesce(metadata,'{}'),'{locked_fields}',coalesce(metadata->'locked_fields','[]')-'title') WHERE id=w.id; END IF;
 -- Empty legacy fields were locked by migration; they should still accept their first value.
 UPDATE public.records SET metadata=jsonb_set(coalesce(metadata,'{}'),'{locked_fields}',
  (SELECT coalesce(jsonb_agg(value),'[]') FROM jsonb_array_elements_text(coalesce(r.metadata->'locked_fields','[]'))
   WHERE NOT (value='publisher' AND coalesce(r.publisher,'')='') AND NOT (value IN('publication_date','publication_date_precision') AND coalesce(r.publication_date::text,'')=''))) WHERE id=r.id;
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO wp FROM jsonb_each(p_payload->'work') WHERE value<>'null'::jsonb AND value<>'""'::jsonb;
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO rp FROM jsonb_each(p_payload->'record') WHERE key<>'metadata' AND value<>'null'::jsonb AND value<>'""'::jsonb;
 SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO mp FROM jsonb_each(coalesce(p_payload->'record'->'metadata','{}')) WHERE value<>'null'::jsonb AND value<>'""'::jsonb;
 PERFORM public.apply_metadata_fields(w.id,r.id,wp,rp,mp);
 IF NOT coalesce(r.metadata->'locked_fields','[]') ? 'contributors' AND jsonb_array_length(coalesce(p_payload->'credits','[]'))>0 THEN
  FOR person IN SELECT value FROM jsonb_array_elements(p_payload->'credits') LOOP
   contributor=NULL;
   FOR authority IN SELECT key,value FROM jsonb_each_text(coalesce(person->'identifiers','{}')) LOOP
    SELECT contributor_id INTO known FROM public.contributor_identifiers WHERE user_id=p_user AND scheme=authority.key AND value=authority.value;
    IF known IS NOT NULL THEN
     IF contributor IS NOT NULL AND contributor<>known THEN RAISE EXCEPTION 'conflicting contributor identities'; END IF;
     contributor=known;
    END IF;
   END LOOP;
   resolved=CASE WHEN contributor IS NULL THEN 'new' ELSE 'identifier' END;
   IF contributor IS NULL THEN
    -- Names alone cannot establish identity; keep new imports provisional.
    INSERT INTO public.contributors(user_id,kind,display_name,family_name,given_names,particle,suffix,sort_name,match_key,status)
    VALUES(p_user,person->>'kind',person->>'display_name',person->>'family_name',person->>'given_names',person->>'particle',person->>'suffix',person->>'sort_name',person->>'match_key','provisional') RETURNING id INTO contributor;
   END IF;
   FOR authority IN SELECT key,value FROM jsonb_each_text(coalesce(person->'identifiers','{}')) LOOP
    INSERT INTO public.contributor_identifiers(user_id,contributor_id,scheme,value) VALUES(p_user,contributor,authority.key,authority.value) ON CONFLICT(user_id,scheme,value) DO NOTHING;
   END LOOP;
   role=coalesce(person->>'role','author');
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(credits) c WHERE c->>'contributor_id'=contributor::text AND c->>'role'=role) THEN CONTINUE; END IF;
   position=coalesce((positions->>role)::int,0); positions=positions||jsonb_build_object(role,position+1);
   credits=credits||jsonb_build_array(jsonb_build_object('contributor_id',contributor,'role',role,'position',position,'credited_as',person->>'credited_as','affiliation',person->>'affiliation','resolved_by',resolved));
  END LOOP;
  PERFORM public.set_metadata_contributors(r.id,credits);
 END IF;
 INSERT INTO public.identifiers(record_id,scheme,normalized_value,original_value)
 SELECT r.id,value->>'scheme',value->>'value',value->>'value' FROM jsonb_array_elements(p_payload->'identifiers') ON CONFLICT(record_id,scheme,normalized_value) DO NOTHING;
 IF p_payload->'record'->'metadata'->>'cover_url' IS NOT NULL THEN
  INSERT INTO public.jobs(user_id,job_type,payload,idempotency_key) VALUES(p_user,'process_cover',
   jsonb_build_object('record_id',r.id,'url',p_payload->'record'->'metadata'->>'cover_url'),
   'process_cover:'||r.id||':'||(p_payload->'record'->'metadata'->>'cover_url')) ON CONFLICT(idempotency_key) DO NOTHING;
 END IF;
 PERFORM set_config('request.jwt.claims',coalesce(original_claims,''),true);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.apply_background_metadata(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_background_metadata(UUID,UUID,JSONB) TO service_role;

-- Service operations keep their worker actor even while using owner-scoped catalog helpers.
CREATE OR REPLACE FUNCTION private.event_actor(OUT actor TEXT, OUT detail TEXT) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE claims JSONB := auth.jwt(); headers TEXT := nullif(current_setting('request.headers', true), ''); header TEXT; token UUID;
BEGIN
  IF coalesce(claims->>'textus_agent', 'false') = 'true' THEN
    header := 'agent:' || coalesce(claims->>'textus_token_id', '');
  ELSIF auth.uid() IS NOT NULL AND coalesce(claims->>'role','')<>'service_role' THEN
    actor := 'user'; RETURN;
  ELSIF headers IS NOT NULL THEN
    BEGIN header := headers::json->>'x-textus-actor'; EXCEPTION WHEN others THEN header := NULL; END;
  END IF;
  IF header LIKE 'agent:%' THEN
    BEGIN token := substr(header, 7)::uuid; EXCEPTION WHEN others THEN token := NULL; END;
    actor := 'agent'; detail := coalesce((SELECT t.name FROM public.agent_tokens t WHERE t.id = token), 'agent');
  ELSIF header = 'user' THEN
    actor := 'user';
  ELSIF header LIKE 'job:%' THEN
    actor := 'textus'; detail := left(substr(header, 5), 60);
  ELSE
    actor := 'textus'; detail := CASE WHEN headers IS NULL THEN 'database' ELSE 'system' END;
  END IF;
END $$;
