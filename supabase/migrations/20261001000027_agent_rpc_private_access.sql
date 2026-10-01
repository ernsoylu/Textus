-- Only service_role can invoke these wrappers. Their definer reaches the unexposed private schema;
-- ownership/scope/live-token/approval checks remain inside the transaction.
ALTER FUNCTION public.request_agent_action(UUID,UUID,TEXT,JSONB,JSONB) SECURITY DEFINER;
ALTER FUNCTION public.execute_agent_action(UUID,UUID) SECURITY DEFINER;
ALTER FUNCTION public.complete_agent_upload(UUID,UUID,JSONB,JSONB) SECURITY DEFINER;
