-- The app102 library reached the 250,000-passage ceiling at ~400 of ~550 books (about 630 passages a book;
-- one book alone has 7,118), once remote workers sped indexing up. The ceiling rises to 1,000,000 per owner
-- (~10 GB at the measured ~9 KB a passage). SECURITY DEFINER keeps migration 20261003000003's setting, which
-- remote workers (textus_worker) rely on; CREATE OR REPLACE would otherwise reset it.
CREATE OR REPLACE FUNCTION public.commit_passage_batch(p_job UUID,p_generation BIGINT,p_passages JSONB,p_done INT,p_total INT,p_status TEXT DEFAULT 'indexing',p_reason TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.jobs; a public.assets; v_count INT; v_state JSONB;
BEGIN
 SELECT * INTO j FROM public.jobs WHERE id=p_job;
 IF j.id IS NULL THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(j.user_id::text||':index',0));
 SELECT * INTO j FROM public.jobs WHERE id=p_job AND status='running' AND claim_generation=p_generation AND lease_expires_at>now() FOR UPDATE;
 IF j.id IS NULL OR j.job_type<>'index_passages' THEN RETURN false; END IF;
 SELECT * INTO a FROM public.assets WHERE id=(j.payload->>'asset_id')::uuid AND user_id=j.user_id AND deleting_at IS NULL FOR UPDATE;
 IF a.id IS NULL OR a.metadata->'passage_index'->>'version' IS DISTINCT FROM j.payload->>'index_version' THEN RETURN false; END IF;
 IF jsonb_array_length(p_passages)>1024 OR p_done<coalesce((a.metadata->'passage_index'->>'done')::int,0) OR p_done>p_total OR p_total>100000 OR p_status NOT IN('indexing','complete','no_text','not_indexable','partial') THEN RAISE EXCEPTION 'invalid checkpoint'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(j.user_id::text||':index',0));
 IF (SELECT count(*) FROM public.asset_passages WHERE user_id=j.user_id)+jsonb_array_length(p_passages)>1000000 THEN RAISE EXCEPTION 'passage quota exceeded' USING ERRCODE='53300'; END IF;
 INSERT INTO public.asset_passages(asset_id,user_id,index_version,ordinal,page,page_label,section,cfi,content)
 SELECT a.id,j.user_id,j.payload->>'index_version',x.ordinal,x.page,x.page_label,x.section,x.cfi,x.content FROM jsonb_to_recordset(p_passages) AS x(ordinal INT,page INT,page_label TEXT,section INT,cfi TEXT,content TEXT)
 ON CONFLICT(asset_id,index_version,ordinal) DO NOTHING;
 SELECT count(*)::int INTO v_count FROM public.asset_passages WHERE asset_id=a.id AND index_version=j.payload->>'index_version';
 v_state=jsonb_build_object('version',j.payload->>'index_version','status',p_status,'done',p_done,'total',p_total,'passages',v_count,'reason',p_reason);
 UPDATE public.assets SET metadata=jsonb_set(coalesce(metadata,'{}'),'{passage_index}',v_state) WHERE id=a.id;
 -- Checkpoint and continuation are one transaction, including cancellation/generation checks.
 RETURN public.finish_job(j.id,j.claim_generation,v_state,NULL,CASE WHEN p_status='indexing' THEN j.payload||jsonb_build_object('from',p_done,'ordinal',v_count) ELSE NULL END);
END $$;
