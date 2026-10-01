-- M6.2: private, generation-fenced full-document passage indexing; FTS needs no AI.
ALTER TABLE public.assets ADD CONSTRAINT assets_id_user_unique UNIQUE(id,user_id);
CREATE TABLE public.asset_passages (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 asset_id UUID NOT NULL, user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 index_version TEXT NOT NULL, ordinal INT NOT NULL CHECK(ordinal>=0),
 page INT CHECK(page>0), page_label TEXT, section INT CHECK(section>=0), cfi TEXT,
 content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 8000),
 search_vector tsvector GENERATED ALWAYS AS(to_tsvector('simple',content)) STORED,
 UNIQUE(asset_id,index_version,ordinal),
 FOREIGN KEY(asset_id,user_id) REFERENCES public.assets(id,user_id) ON DELETE CASCADE
);
CREATE INDEX asset_passages_fts ON public.asset_passages USING gin(search_vector);
CREATE INDEX asset_passages_owner ON public.asset_passages(user_id,asset_id);
ALTER TABLE public.asset_passages ENABLE ROW LEVEL SECURITY;
CREATE POLICY passages_owner_select ON public.asset_passages FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
REVOKE INSERT,UPDATE,DELETE ON public.asset_passages FROM anon,authenticated;
ALTER TABLE public.jobs DROP CONSTRAINT jobs_job_type_check;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_job_type_check CHECK(job_type IN('extract_text','generate_thumbnail','fetch_metadata','process_cover','export_data','cleanup','index_passages','embed_passages','extract_metadata_ai'));

CREATE FUNCTION private.queue_passage_index(p_asset UUID,p_owner UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.assets; v TEXT=gen_random_uuid()::text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text||':index',0));
 SELECT * INTO a FROM public.assets WHERE id=p_asset AND user_id=p_owner AND deleting_at IS NULL FOR UPDATE;
 IF a.id IS NULL OR a.file_format NOT IN('pdf','epub') OR NOT EXISTS(SELECT 1 FROM public.record_assets WHERE asset_id=a.id) THEN RETURN false; END IF;
 IF (SELECT count(*) FROM public.jobs WHERE user_id=p_owner AND status IN('queued','running'))>=500 THEN RAISE EXCEPTION 'job quota exceeded' USING ERRCODE='53300'; END IF;
 UPDATE public.jobs SET status='cancelled',claim_generation=claim_generation+1,lease_expires_at=NULL WHERE user_id=p_owner AND job_type IN('index_passages','embed_passages') AND payload->>'asset_id'=p_asset::text AND status IN('queued','running');
 DELETE FROM public.asset_passages WHERE asset_id=p_asset;
 UPDATE public.assets SET metadata=jsonb_set(coalesce(metadata,'{}'),'{passage_index}',jsonb_build_object('version',v,'status','queued','done',0,'total',0,'passages',0)) WHERE id=p_asset;
 INSERT INTO public.jobs(user_id,job_type,payload,idempotency_key) VALUES(p_owner,'index_passages',jsonb_build_object('asset_id',p_asset,'index_version',v,'from',0),'index_passages:'||p_asset||':'||v);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.queue_passage_index(UUID,UUID) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.queue_passage_index(p_asset UUID,p_owner UUID) RETURNS BOOLEAN LANGUAGE sql SET search_path='' AS $$ SELECT private.queue_passage_index(p_asset,p_owner) $$;
REVOKE ALL ON FUNCTION public.queue_passage_index(UUID,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_passage_index(UUID,UUID) TO service_role;

CREATE FUNCTION public.control_passage_index(p_action TEXT,p_asset UUID DEFAULT NULL) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.assets; j public.jobs; n INT=0;
BEGIN
 IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'textus_agent','false')='true' THEN RAISE EXCEPTION 'owner session required' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN('backfill','reindex','retry','cancel') OR (p_action<>'backfill' AND p_asset IS NULL) THEN RAISE EXCEPTION 'invalid action'; END IF;
 FOR a IN SELECT x.* FROM public.assets x WHERE x.user_id=auth.uid() AND x.deleting_at IS NULL AND x.file_format IN('pdf','epub') AND (p_asset IS NULL OR x.id=p_asset)
  AND (p_action<>'backfill' OR x.metadata->'passage_index' IS NULL) ORDER BY x.created_at LIMIT 100 FOR UPDATE
 LOOP
  IF p_action='cancel' THEN
   UPDATE public.jobs SET status='cancelled',claim_generation=claim_generation+1,lease_expires_at=NULL WHERE user_id=auth.uid() AND job_type IN('index_passages','embed_passages') AND payload->>'asset_id'=a.id::text AND status IN('queued','running');
   UPDATE public.assets SET metadata=jsonb_set(metadata,'{passage_index,status}','"cancelled"') WHERE id=a.id AND metadata->'passage_index' IS NOT NULL;
   n=n+1;
  ELSIF p_action='retry' THEN
   SELECT * INTO j FROM public.jobs WHERE user_id=auth.uid() AND job_type='index_passages' AND payload->>'asset_id'=a.id::text AND payload->>'index_version'=a.metadata->'passage_index'->>'version' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
   IF j.status IN('failed','cancelled') THEN
    UPDATE public.jobs SET status='queued',attempts=0,claim_generation=claim_generation+1,available_at=now(),lease_expires_at=NULL,last_error=NULL WHERE id=j.id;
    UPDATE public.assets SET metadata=jsonb_set(metadata,'{passage_index,status}','"queued"') WHERE id=a.id;
    n=n+1;
   END IF;
  ELSIF private.queue_passage_index(a.id,auth.uid()) THEN n=n+1;
  END IF;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.control_passage_index(TEXT,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.control_passage_index(TEXT,UUID) TO authenticated;

CREATE FUNCTION public.commit_passage_batch(p_job UUID,p_generation BIGINT,p_passages JSONB,p_done INT,p_total INT,p_status TEXT DEFAULT 'indexing',p_reason TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SET search_path='' AS $$
DECLARE j public.jobs; a public.assets; v_count INT; v_state JSONB;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=p_job AND status='running' AND claim_generation=p_generation AND lease_expires_at>now() FOR UPDATE;
 IF j.id IS NULL OR j.job_type<>'index_passages' THEN RETURN false; END IF;
 SELECT * INTO a FROM public.assets WHERE id=(j.payload->>'asset_id')::uuid AND user_id=j.user_id AND deleting_at IS NULL FOR UPDATE;
 IF a.id IS NULL OR a.metadata->'passage_index'->>'version' IS DISTINCT FROM j.payload->>'index_version' THEN RETURN false; END IF;
 IF jsonb_array_length(p_passages)>128 OR p_done<coalesce((a.metadata->'passage_index'->>'done')::int,0) OR p_done>p_total OR p_total>100000 OR p_status NOT IN('indexing','complete','no_text','not_indexable','partial') THEN RAISE EXCEPTION 'invalid checkpoint'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(j.user_id::text||':index',0));
 IF (SELECT count(*) FROM public.asset_passages WHERE user_id=j.user_id)+jsonb_array_length(p_passages)>50000 THEN RAISE EXCEPTION 'passage quota exceeded' USING ERRCODE='53300'; END IF;
 INSERT INTO public.asset_passages(asset_id,user_id,index_version,ordinal,page,page_label,section,cfi,content)
 SELECT a.id,j.user_id,j.payload->>'index_version',x.ordinal,x.page,x.page_label,x.section,x.cfi,x.content FROM jsonb_to_recordset(p_passages) AS x(ordinal INT,page INT,page_label TEXT,section INT,cfi TEXT,content TEXT)
 ON CONFLICT(asset_id,index_version,ordinal) DO NOTHING;
 SELECT count(*)::int INTO v_count FROM public.asset_passages WHERE asset_id=a.id AND index_version=j.payload->>'index_version';
 v_state=jsonb_build_object('version',j.payload->>'index_version','status',p_status,'done',p_done,'total',p_total,'passages',v_count,'reason',p_reason);
 UPDATE public.assets SET metadata=jsonb_set(coalesce(metadata,'{}'),'{passage_index}',v_state) WHERE id=a.id;
 -- Checkpoint and continuation are one transaction, including cancellation/generation checks.
 RETURN public.finish_job(j.id,j.claim_generation,v_state,NULL,CASE WHEN p_status='indexing' THEN j.payload||jsonb_build_object('from',p_done,'ordinal',v_count) ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.commit_passage_batch(UUID,BIGINT,JSONB,INT,INT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_passage_batch(UUID,BIGINT,JSONB,INT,INT,TEXT,TEXT) TO service_role;

CREATE FUNCTION public.passage_coverage(p_work_ids UUID[] DEFAULT NULL) RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH owned AS(SELECT DISTINCT a.id,a.metadata->'passage_index' AS state FROM public.assets a JOIN public.record_assets ra ON ra.asset_id=a.id JOIN public.records r ON r.id=ra.record_id JOIN public.works w ON w.id=r.work_id WHERE a.user_id=auth.uid() AND a.deleting_at IS NULL AND a.file_format IN('pdf','epub') AND (p_work_ids IS NULL OR w.id=ANY(p_work_ids)))
 SELECT jsonb_build_object('eligibleAssets',count(*),'indexedAssets',count(*) FILTER(WHERE state->>'status'='complete'),'partial',coalesce(bool_or(coalesce(state->>'status','pending')<>'complete'),false)) FROM owned
$$;
CREATE FUNCTION public.search_passages(p_query TEXT,p_limit INT DEFAULT 20,p_work_ids UUID[] DEFAULT NULL)
RETURNS TABLE(id BIGINT,asset_id UUID,record_id UUID,work_id UUID,title TEXT,byline TEXT,year INT,page INT,page_label TEXT,section INT,cfi TEXT,content TEXT,score REAL)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH q AS(SELECT websearch_to_tsquery('simple',left(p_query,1000)) query), hits AS(
 SELECT p.*,ts_rank_cd(p.search_vector,q.query) rank FROM public.asset_passages p JOIN public.assets a ON a.id=p.asset_id,q
 WHERE p.user_id=auth.uid() AND a.deleting_at IS NULL AND p.index_version=a.metadata->'passage_index'->>'version' AND p.search_vector@@q.query)
 SELECT h.id,h.asset_id,link.record_id,link.work_id,link.title,link.byline,link.publication_year,h.page,h.page_label,h.section,h.cfi,h.content,h.rank
 FROM hits h JOIN LATERAL(
 SELECT r.id record_id,w.id work_id,coalesce(r.title,w.title) title,extract(year FROM r.publication_date)::int publication_year,
 (SELECT string_agg(coalesce(rc.credited_as,c.display_name),', ' ORDER BY rc.position) FROM public.record_contributors rc JOIN public.contributors c ON c.id=rc.contributor_id WHERE rc.record_id=r.id AND rc.role='author') byline
 FROM public.record_assets ra JOIN public.records r ON r.id=ra.record_id JOIN public.works w ON w.id=r.work_id
 WHERE ra.asset_id=h.asset_id AND w.user_id=auth.uid() AND (p_work_ids IS NULL OR (cardinality(p_work_ids)<=100 AND w.id=ANY(p_work_ids))) ORDER BY r.created_at,r.id LIMIT 1
 )link ON true ORDER BY h.rank DESC,h.id LIMIT greatest(1,least(p_limit,20))
$$;
REVOKE ALL ON FUNCTION public.passage_coverage(UUID[]),public.search_passages(TEXT,INT,UUID[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.passage_coverage(UUID[]),public.search_passages(TEXT,INT,UUID[]) TO authenticated;
-- Existing eligible files are scheduled in small owner-visible batches, without touching bytes.
DO $$ DECLARE a RECORD; BEGIN FOR a IN SELECT x.id,x.user_id FROM public.assets x WHERE x.file_format IN('pdf','epub') AND x.deleting_at IS NULL AND EXISTS(SELECT 1 FROM public.record_assets ra WHERE ra.asset_id=x.id) AND (SELECT count(*) FROM public.jobs j WHERE j.user_id=x.user_id AND j.status IN('queued','running'))<400 LOOP IF (SELECT count(*) FROM public.jobs j WHERE j.user_id=a.user_id AND j.status IN('queued','running'))<400 THEN PERFORM private.queue_passage_index(a.id,a.user_id); END IF; END LOOP; END $$;
