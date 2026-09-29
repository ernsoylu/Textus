-- Manual NFR-PERF-1 benchmark. Run with:
--   docker exec -i supabase_db_Textus psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/database/library_perf.sql
-- Seeds 10,000 works and records, measures 35 warm-cache calls after 5 warmups, then rolls everything back.
\timing on
BEGIN;
INSERT INTO auth.users (id, email) VALUES ('f0000000-1111-4000-8000-000000000001', 'perf@test.local');
INSERT INTO works (id, user_id, work_type, title, language, created_at)
SELECT md5(i::text)::uuid, 'f0000000-1111-4000-8000-000000000001', 'book', 'Benchmarktoken Work ' || i, 'en', NOW() - (i || ' seconds')::interval
FROM generate_series(1, 10000) i;
INSERT INTO records (id, work_id, record_type)
SELECT md5('r' || i::text)::uuid, md5(i::text)::uuid, 'edition'
FROM generate_series(1, 10000) i;
ANALYZE works;
ANALYZE records;

CREATE TEMP TABLE perf_samples (kind TEXT, elapsed_ms DOUBLE PRECISION);
GRANT ALL ON perf_samples TO authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"f0000000-1111-4000-8000-000000000001","role":"authenticated"}';
DO $$
DECLARE started TIMESTAMPTZ;
BEGIN
  FOR i IN 1..5 LOOP
    PERFORM count(*) FROM public.library_page();
    PERFORM count(*) FROM public.library_page(p_q => 'benchmarktoken', p_sort => 'relevance');
  END LOOP;
  FOR i IN 1..35 LOOP
    started := clock_timestamp();
    PERFORM count(*) FROM public.library_page();
    INSERT INTO perf_samples VALUES ('list', extract(epoch FROM clock_timestamp() - started) * 1000);
    started := clock_timestamp();
    PERFORM count(*) FROM public.library_page(p_q => 'benchmarktoken', p_sort => 'relevance');
    INSERT INTO perf_samples VALUES ('search', extract(epoch FROM clock_timestamp() - started) * 1000);
  END LOOP;
END $$;
RESET ROLE;

SELECT kind, round(percentile_cont(0.95) WITHIN GROUP (ORDER BY elapsed_ms)::NUMERIC, 2) AS p95_ms,
       round(avg(elapsed_ms)::NUMERIC, 2) AS mean_ms, max(round(elapsed_ms::NUMERIC, 2)) AS max_ms
FROM perf_samples GROUP BY kind ORDER BY kind;
DO $$
BEGIN
  IF (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY elapsed_ms) FROM perf_samples WHERE kind = 'list') >= 300
     OR (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY elapsed_ms) FROM perf_samples WHERE kind = 'search') >= 300 THEN
    RAISE EXCEPTION 'NFR-PERF-1 failed: p95 must be below 300 ms';
  END IF;
END $$;
ROLLBACK;
