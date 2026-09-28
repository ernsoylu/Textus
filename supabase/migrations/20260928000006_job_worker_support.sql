-- Support for job-worker (§8.3). claim_jobs() only re-claims jobs that are still 'queued' or
-- whose lease expired with attempts left — a job claimed on its FINAL attempt that then fails
-- or crashes stays 'running' forever otherwise, since claim_jobs()'s WHERE excludes
-- attempts >= max_attempts. This sweeps those into 'failed' explicitly.
CREATE OR REPLACE FUNCTION public.expire_stale_jobs()
RETURNS INT LANGUAGE sql SET search_path = '' AS $$
    WITH updated AS (
        UPDATE public.jobs
        SET status = 'failed', completed_at = NOW(), last_error = 'exceeded max_attempts (lease expired)'
        WHERE status = 'running' AND lease_expires_at < NOW() AND attempts >= max_attempts
        RETURNING 1
    )
    SELECT count(*)::int FROM updated;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_stale_jobs() FROM PUBLIC, anon, authenticated;
