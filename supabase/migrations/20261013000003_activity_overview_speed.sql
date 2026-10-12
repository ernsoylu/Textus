-- activity_overview() hit the 8 s statement_timeout on app102 (861 files, 3.5k jobs: 6.3 s). Each job looked up its
-- record's primary file with ra.record_id::text = payload->>'record_id', which no index serves, so record_assets was
-- scanned (with its RLS check) per job: 5.3 s. Primary files are now mapped once and hash-joined. The per-file
-- index/embed job lookups (~1 s) come from the queue CTE, which already groups exactly those jobs.
-- When several jobs or primary files compete, running beats queued and the lowest asset id wins, instead of LIMIT 1's
-- arbitrary pick.
CREATE OR REPLACE FUNCTION public.activity_overview()
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
  queue AS (
    SELECT g.asset, g.index_job, g.embed_job,
      (count(*) OVER (ORDER BY g.moved DESC NULLS LAST, g.first_at, g.asset ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING))::int ahead
    FROM (SELECT j.payload->>'asset_id' asset, max(j.prioritized_at) moved, min(j.created_at) first_at,
        max(j.status) FILTER (WHERE j.job_type = 'index_passages') index_job, max(j.status) FILTER (WHERE j.job_type = 'embed_passages') embed_job
      FROM public.jobs j WHERE j.job_type IN ('index_passages','embed_passages') AND j.status IN ('queued','running') GROUP BY 1) g),
  primaries AS (
    SELECT DISTINCT ON (ra.record_id) ra.record_id::text record_id, ra.asset_id::text asset
    FROM public.record_assets ra WHERE ra.role = 'primary' ORDER BY ra.record_id, ra.asset_id),
  steps AS (
    SELECT coalesce(j.payload->>'asset_id', p.asset) asset,
      array_agg(DISTINCT j.job_type) FILTER (WHERE j.status IN ('queued','running')) pending,
      array_agg(DISTINCT j.job_type) FILTER (WHERE j.status = 'failed') failed
    FROM public.jobs j LEFT JOIN primaries p ON p.record_id = j.payload->>'record_id'
    WHERE j.job_type IN ('extract_text','fetch_metadata','process_cover','extract_metadata_ai')
    GROUP BY 1)
  SELECT f.id, f.work_id, f.record_id, f.title, f.byline, f.file_format, f.file_size, f.created_at, f.processing_state, f.processing_error,
    f.metadata->'passage_index', f.metadata->'embedding_index', q.index_job, q.ahead, q.embed_job,
    coalesce(s.pending, '{}'), coalesce(s.failed, '{}')
  FROM files f LEFT JOIN queue q ON q.asset = f.id::text LEFT JOIN steps s ON s.asset = f.id::text
  ORDER BY f.created_at DESC, f.id
$$;
