-- The public service-only wrapper must reach the deliberately revoked private implementation.
ALTER FUNCTION public.queue_passage_index(UUID,UUID) SECURITY DEFINER;
