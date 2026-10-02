-- claim_storage_cleanup() finds folders of deleted users by reading auth.users, which service_role
-- cannot SELECT on self-hosted Supabase, so the daily cleanup job failed on its first production run.
-- It runs as its owner instead; EXECUTE stays service_role-only and search_path stays empty.
ALTER FUNCTION public.claim_storage_cleanup(INT) SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.claim_storage_cleanup(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_storage_cleanup(INT) TO service_role;
