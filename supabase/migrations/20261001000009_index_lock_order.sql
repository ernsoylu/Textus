-- Index controls and checkpoints use owner advisory lock, then jobs, then asset rows.
CREATE OR REPLACE FUNCTION private.queue_passage_index(p_asset UUID,p_owner UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.assets; v TEXT=gen_random_uuid()::text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_owner::text||':index',0));
 PERFORM 1 FROM public.jobs WHERE user_id=p_owner AND job_type IN('index_passages','embed_passages') AND payload->>'asset_id'=p_asset::text ORDER BY id FOR UPDATE;
 SELECT * INTO a FROM public.assets WHERE id=p_asset AND user_id=p_owner AND deleting_at IS NULL FOR UPDATE;
 IF a.id IS NULL OR a.file_format NOT IN('pdf','epub') OR NOT EXISTS(SELECT 1 FROM public.record_assets WHERE asset_id=a.id) THEN RETURN false; END IF;
 IF (SELECT count(*) FROM public.jobs WHERE user_id=p_owner AND status IN('queued','running'))>=500 THEN RAISE EXCEPTION 'job quota exceeded' USING ERRCODE='53300'; END IF;
 UPDATE public.jobs SET status='cancelled',claim_generation=claim_generation+1,lease_expires_at=NULL WHERE user_id=p_owner AND job_type IN('index_passages','embed_passages') AND payload->>'asset_id'=p_asset::text AND status IN('queued','running');
 DELETE FROM public.asset_passages WHERE asset_id=p_asset;
 UPDATE public.assets SET metadata=jsonb_set(coalesce(metadata,'{}'),'{passage_index}',jsonb_build_object('version',v,'status','queued','done',0,'total',0,'passages',0)) WHERE id=p_asset;
 INSERT INTO public.jobs(user_id,job_type,payload,idempotency_key) VALUES(p_owner,'index_passages',jsonb_build_object('asset_id',p_asset,'index_version',v,'from',0),'index_passages:'||p_asset||':'||v);
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.control_passage_index(p_action TEXT,p_asset UUID DEFAULT NULL) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.assets; j public.jobs; n INT=0;
BEGIN
 IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'textus_agent','false')='true' THEN RAISE EXCEPTION 'owner session required' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN('backfill','reindex','retry','cancel') OR (p_action<>'backfill' AND p_asset IS NULL) THEN RAISE EXCEPTION 'invalid action'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':index',0));
 PERFORM 1 FROM public.jobs WHERE user_id=auth.uid() AND job_type IN('index_passages','embed_passages') AND (p_asset IS NULL OR payload->>'asset_id'=p_asset::text) ORDER BY id FOR UPDATE;
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

CREATE OR REPLACE FUNCTION public.commit_passage_batch(p_job UUID,p_generation BIGINT,p_passages JSONB,p_done INT,p_total INT,p_status TEXT DEFAULT 'indexing',p_reason TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SET search_path='' AS $$
DECLARE j public.jobs; a public.assets; v_count INT; v_state JSONB;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=p_job;
 IF j.id IS NULL THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(j.user_id::text||':index',0));
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
