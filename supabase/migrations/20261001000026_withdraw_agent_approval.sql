CREATE OR REPLACE FUNCTION public.review_agent_action(p_action UUID,p_approve BOOLEAN) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR auth.jwt()->>'textus_agent'='true' THEN RAISE EXCEPTION 'owner session required' USING ERRCODE='42501'; END IF;
 UPDATE public.agent_actions SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END WHERE id=p_action AND user_id=auth.uid() AND (status='pending' OR (NOT p_approve AND status='approved')) AND expires_at>now() AND token_id IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'pending action unavailable' USING ERRCODE='42501'; END IF;
END $$;
