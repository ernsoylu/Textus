-- Shared validated identifiers are accepted for approved agent catalog creation too.
-- Bind browser imports to their original account and retain authority-match provenance.
CREATE OR REPLACE FUNCTION private.create_catalog(p_request UUID,p_payload JSONB) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner UUID=auth.uid(); v_previous public.catalog_requests; v_work public.works; v_record public.records;
 v_work_id UUID;v_record_id UUID;v_result JSONB;v_identifier JSONB;v_person JSONB;v_credit_id UUID;v_known UUID;v_authority RECORD;v_tag TEXT;v_tag_id UUID;
 v_credits JSONB='[]';v_positions JSONB='{}';v_role TEXT;v_position INT;v_resolved TEXT;v_existing BOOLEAN=false;
BEGIN
 IF p_payload ? 'expectedOwner' AND p_payload->>'expectedOwner' IS DISTINCT FROM v_owner::text THEN RAISE EXCEPTION 'account changed' USING ERRCODE='42501'; END IF;
 IF v_owner IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>32768 OR jsonb_array_length(coalesce(p_payload->'credits','[]'))>24 OR jsonb_array_length(coalesce(p_payload->'identifiers','[]'))>10 OR jsonb_array_length(coalesce(p_payload->'tags','[]'))>50 THEN RAISE EXCEPTION 'invalid catalog payload'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text||':catalog',0));
 SELECT * INTO v_previous FROM public.catalog_requests WHERE user_id=v_owner AND id=p_request;
 IF v_previous.id IS NOT NULL THEN
  IF v_previous.payload<>p_payload THEN RAISE EXCEPTION 'request ID bound to different catalog input' USING ERRCODE='23514'; END IF;
  RETURN v_previous.result;
 END IF;
 SELECT * INTO v_work FROM jsonb_populate_record(NULL::public.works,p_payload->'work');
 SELECT * INTO v_record FROM jsonb_populate_record(NULL::public.records,p_payload->'record');
 IF length(btrim(v_work.title)) NOT BETWEEN 1 AND 500 OR v_work.title IS NULL OR length(coalesce(v_work.abstract,''))>10000 THEN RAISE EXCEPTION 'invalid title or abstract'; END IF;
 FOR v_identifier IN SELECT value FROM jsonb_array_elements(coalesce(p_payload->'identifiers','[]')) LOOP
  IF v_identifier->>'scheme' NOT IN('doi','isbn','issn','arxiv','pmid','iso','iec','astm','asme','bs') OR length(coalesce(v_identifier->>'value','')) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid identifier'; END IF;
  SELECT r.id,w.id INTO v_record_id,v_work_id FROM public.identifiers i JOIN public.records r ON r.id=i.record_id JOIN public.works w ON w.id=r.work_id WHERE w.user_id=v_owner AND i.scheme=v_identifier->>'scheme' AND i.normalized_value=v_identifier->>'value' ORDER BY r.id LIMIT 1;
  IF v_work_id IS NOT NULL THEN v_existing=true; EXIT; END IF;
 END LOOP;
 IF NOT v_existing THEN
  IF (SELECT count(*) FROM public.works WHERE user_id=v_owner)>=100000 THEN RAISE EXCEPTION 'catalog quota exceeded' USING ERRCODE='53300'; END IF;
  INSERT INTO public.works(user_id,work_type,title,subtitle,abstract,language) VALUES(v_owner,v_work.work_type,btrim(v_work.title),v_work.subtitle,v_work.abstract,v_work.language) RETURNING id INTO v_work_id;
  INSERT INTO public.records(work_id,record_type,publisher,volume,issue_number,pages,publication_date,publication_date_precision,metadata_source,metadata_fetched_at,metadata)
  VALUES(v_work_id,v_record.record_type,v_record.publisher,v_record.volume,v_record.issue_number,v_record.pages,v_record.publication_date,v_record.publication_date_precision,v_record.metadata_source,v_record.metadata_fetched_at,CASE WHEN coalesce((p_payload->>'lockCredits')::boolean,false) THEN '{"locked_fields":["contributors"]}'::jsonb ELSE '{}'::jsonb END) RETURNING id INTO v_record_id;
  FOR v_identifier IN SELECT value FROM jsonb_array_elements(coalesce(p_payload->'identifiers','[]')) LOOP
   INSERT INTO public.identifiers(record_id,scheme,normalized_value,original_value) VALUES(v_record_id,v_identifier->>'scheme',v_identifier->>'value',v_identifier->>'value');
  END LOOP;
  FOR v_person IN SELECT value FROM jsonb_array_elements(coalesce(p_payload->'credits','[]')) LOOP
   IF length(btrim(coalesce(v_person->>'display_name',''))) NOT BETWEEN 1 AND 300 OR (v_person->>'kind'='person' AND btrim(coalesce(v_person->>'family_name',''))='') THEN RAISE EXCEPTION 'invalid contributor'; END IF;
   v_credit_id=NULL;v_known=NULL;v_resolved='new';
   IF v_person->>'contributor_id' IS NOT NULL THEN
    SELECT id INTO v_credit_id FROM public.contributors WHERE id=(v_person->>'contributor_id')::uuid AND user_id=v_owner;
    v_resolved='user';
    IF v_credit_id IS NULL THEN RAISE EXCEPTION 'contributor not owned' USING ERRCODE='42501'; END IF;
   END IF;
   FOR v_authority IN SELECT key,value FROM jsonb_each_text(coalesce(v_person->'identifiers','{}')) LOOP
    SELECT contributor_id INTO v_known FROM public.contributor_identifiers WHERE user_id=v_owner AND scheme=v_authority.key AND value=v_authority.value;
    IF v_known IS NOT NULL THEN
     IF v_credit_id IS NOT NULL AND v_known<>v_credit_id THEN RAISE EXCEPTION 'conflicting contributor identities'; END IF;
     v_credit_id=v_known;v_resolved='identifier';
    END IF;
   END LOOP;
   IF v_credit_id IS NULL THEN
    -- Names alone do not establish identity; imported contributors are provisional.
    INSERT INTO public.contributors(user_id,kind,display_name,family_name,given_names,particle,suffix,sort_name,match_key,status)
    VALUES(v_owner,v_person->>'kind',v_person->>'display_name',v_person->>'family_name',v_person->>'given_names',v_person->>'particle',v_person->>'suffix',v_person->>'sort_name',v_person->>'match_key','provisional') RETURNING id INTO v_credit_id;
   END IF;
   FOR v_authority IN SELECT key,value FROM jsonb_each_text(coalesce(v_person->'identifiers','{}')) LOOP
    INSERT INTO public.contributor_identifiers(user_id,contributor_id,scheme,value) VALUES(v_owner,v_credit_id,v_authority.key,v_authority.value) ON CONFLICT(user_id,scheme,value) DO NOTHING;
   END LOOP;
   v_role=coalesce(v_person->>'role','author');v_position=coalesce((v_positions->>v_role)::int,0);
   v_positions=v_positions||jsonb_build_object(v_role,v_position+1);
   v_credits=v_credits||jsonb_build_array(jsonb_build_object('contributor_id',v_credit_id,'role',v_role,'position',v_position,'credited_as',v_person->>'credited_as','affiliation',v_person->>'affiliation','resolved_by',v_resolved));
  END LOOP;
  IF jsonb_array_length(v_credits)>0 THEN PERFORM public.set_record_contributors(v_record_id,v_credits); END IF;
  FOR v_tag IN SELECT DISTINCT btrim(value) FROM jsonb_array_elements_text(coalesce(p_payload->'tags','[]')) LOOP
   IF length(v_tag) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid tag'; END IF;
   SELECT id INTO v_tag_id FROM public.tags WHERE user_id=v_owner AND lower(name)=lower(v_tag) ORDER BY id LIMIT 1;
   IF v_tag_id IS NULL THEN INSERT INTO public.tags(user_id,name) VALUES(v_owner,v_tag) RETURNING id INTO v_tag_id; END IF;
   INSERT INTO public.record_tags(record_id,tag_id) VALUES(v_record_id,v_tag_id) ON CONFLICT DO NOTHING;
  END LOOP;
 END IF;
 v_result=jsonb_build_object('status',CASE WHEN v_existing THEN 'existing' ELSE 'created' END,'workId',v_work_id,'recordId',v_record_id);
 INSERT INTO public.catalog_requests(user_id,id,payload,result) VALUES(v_owner,p_request,p_payload,v_result);
 RETURN v_result;
END $$;
