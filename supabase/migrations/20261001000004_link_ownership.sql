CREATE OR REPLACE FUNCTION private.guard_asset_link() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_asset public.assets; v_owner UUID;
BEGIN
  SELECT * INTO v_asset FROM public.assets WHERE id=NEW.asset_id FOR UPDATE;
  SELECT w.user_id INTO v_owner FROM public.records r JOIN public.works w ON w.id=r.work_id WHERE r.id=NEW.record_id;
  IF v_owner IS DISTINCT FROM v_asset.user_id THEN
    RAISE EXCEPTION 'asset ownership mismatch' USING ERRCODE='42501';
  END IF;
  IF v_asset.id IS NULL OR v_asset.deleting_at IS NOT NULL THEN
    RAISE EXCEPTION 'asset unavailable or ownership mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
