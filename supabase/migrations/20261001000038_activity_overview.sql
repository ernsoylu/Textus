-- Activity shows each book's progress through every stage. Embedding checkpoints record how many of the
-- file's passages are embedded, so the page never counts passage rows.
CREATE OR REPLACE FUNCTION public.commit_embedding_batch(p_job UUID,p_generation BIGINT,p_vectors JSONB) RETURNS BOOLEAN LANGUAGE plpgsql SET search_path='' AS $$
DECLARE j public.jobs; a public.assets; owner_id UUID; remaining BOOLEAN; embedded INT; total INT;
BEGIN
 SELECT user_id INTO owner_id FROM public.jobs WHERE id=p_job;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||':index',0));
 SELECT * INTO j FROM public.jobs WHERE id=p_job AND status='running' AND claim_generation=p_generation AND lease_expires_at>now() FOR UPDATE;
 IF j.id IS NULL OR j.job_type<>'embed_passages' THEN RETURN false; END IF;
 SELECT * INTO a FROM public.assets WHERE id=(j.payload->>'asset_id')::uuid AND user_id=j.user_id AND deleting_at IS NULL FOR UPDATE;
 IF a.id IS NULL OR a.metadata->'passage_index'->>'version' IS DISTINCT FROM j.payload->>'index_version' OR a.metadata->'passage_index'->>'status'='cancelled' THEN RETURN false; END IF;
 IF jsonb_array_length(p_vectors) NOT BETWEEN 1 AND 256 OR (SELECT count(DISTINCT x.id) FROM jsonb_to_recordset(p_vectors) x(id BIGINT))<>jsonb_array_length(p_vectors) OR EXISTS(SELECT 1 FROM jsonb_to_recordset(p_vectors) x(id BIGINT) WHERE NOT EXISTS(SELECT 1 FROM public.asset_passages p WHERE p.id=x.id AND p.asset_id=a.id AND p.user_id=j.user_id AND p.index_version=j.payload->>'index_version')) THEN RAISE EXCEPTION 'invalid embedding batch'; END IF;
 UPDATE public.asset_passages p SET embedding=x.embedding::extensions.vector(768),embedding_digest=j.payload->>'digest'
 FROM jsonb_to_recordset(p_vectors) x(id BIGINT,embedding TEXT)
 WHERE p.id=x.id AND p.asset_id=a.id AND p.user_id=j.user_id AND p.index_version=j.payload->>'index_version';
 IF NOT FOUND THEN RAISE EXCEPTION 'embedding batch contains no owned passages'; END IF;
 SELECT count(*) FILTER (WHERE p.embedding_digest=j.payload->>'digest'),count(*) INTO embedded,total FROM public.asset_passages p WHERE p.asset_id=a.id AND p.index_version=j.payload->>'index_version';
 remaining:=embedded<total;
 UPDATE public.assets SET metadata=jsonb_set(metadata,'{embedding_index}',jsonb_build_object('digest',j.payload->>'digest','status',CASE WHEN remaining THEN 'indexing' ELSE 'complete' END,'embedded',embedded,'total',total)) WHERE id=a.id;
 RETURN public.finish_job(j.id,j.claim_generation,jsonb_build_object('remaining',remaining),NULL,CASE WHEN remaining THEN j.payload ELSE NULL END);
END $$;

-- One row per primary book file: catalog title/byline, each stage's state, the indexing queue position and the
-- metadata steps still pending or failed. Runs as the caller, so RLS limits it to the owner's files.
CREATE FUNCTION public.activity_overview()
RETURNS TABLE(asset_id UUID, work_id UUID, record_id UUID, title TEXT, byline TEXT, file_format TEXT, file_size BIGINT, added_at TIMESTAMPTZ,
  processing_state TEXT, processing_error TEXT, passage_index JSONB, embedding_index JSONB, index_job TEXT, queue_ahead INT, embed_job TEXT,
  pending_steps TEXT[], failed_steps TEXT[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH files AS (
    SELECT DISTINCT ON (a.id) a.id, a.file_format, a.file_size, a.created_at, a.processing_state, a.processing_error, a.metadata, r.id record_id, w.id work_id,
      coalesce(r.title, w.title) title,
      (SELECT string_agg(coalesce(rc.credited_as, c.display_name), ', ' ORDER BY rc.position) FROM public.record_contributors rc JOIN public.contributors c ON c.id = rc.contributor_id
        WHERE rc.record_id = r.id AND rc.role = 'author') byline
    FROM public.assets a JOIN public.record_assets ra ON ra.asset_id = a.id AND ra.role = 'primary' JOIN public.records r ON r.id = ra.record_id JOIN public.works w ON w.id = r.work_id
    WHERE a.user_id = (SELECT auth.uid()) AND a.deleting_at IS NULL
    ORDER BY a.id, r.created_at, r.id),
  index_queue AS (
    SELECT j.payload->>'asset_id' asset, j.status,
      (count(*) OVER (ORDER BY j.created_at, j.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING))::int ahead
    FROM public.jobs j WHERE j.job_type = 'index_passages' AND j.status IN ('queued','running')),
  steps AS (
    SELECT coalesce(j.payload->>'asset_id', (SELECT ra.asset_id::text FROM public.record_assets ra WHERE ra.record_id::text = j.payload->>'record_id' AND ra.role = 'primary' LIMIT 1)) asset,
      array_agg(DISTINCT j.job_type) FILTER (WHERE j.status IN ('queued','running')) pending,
      array_agg(DISTINCT j.job_type) FILTER (WHERE j.status = 'failed') failed
    FROM public.jobs j WHERE j.job_type IN ('extract_text','fetch_metadata','process_cover','extract_metadata_ai')
    GROUP BY 1)
  SELECT f.id, f.work_id, f.record_id, f.title, f.byline, f.file_format, f.file_size, f.created_at, f.processing_state, f.processing_error,
    f.metadata->'passage_index', f.metadata->'embedding_index', q.status, q.ahead,
    (SELECT e.status FROM public.jobs e WHERE e.job_type = 'embed_passages' AND e.payload->>'asset_id' = f.id::text AND e.status IN ('queued','running') LIMIT 1),
    coalesce(s.pending, '{}'), coalesce(s.failed, '{}')
  FROM files f LEFT JOIN index_queue q ON q.asset = f.id::text LEFT JOIN steps s ON s.asset = f.id::text
  ORDER BY f.created_at DESC, f.id
$$;
REVOKE ALL ON FUNCTION public.activity_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activity_overview() TO authenticated;
