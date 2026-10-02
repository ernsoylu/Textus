-- Book history: an append-only log of every change to a work and everything attached to it, who made it
-- (the owner, an agent, the local AI or Textus itself) and the old and new values. Kept forever; it
-- outlives a deleted book and goes only with the account.
CREATE TABLE public.work_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  work_id UUID NOT NULL, -- no foreign key: history outlives the book
  record_id UUID,
  asset_id UUID,
  actor TEXT NOT NULL CHECK (actor IN ('user','agent','ai','textus')),
  actor_detail TEXT,
  event TEXT NOT NULL,
  summary TEXT NOT NULL,
  changes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX work_events_work ON public.work_events(work_id, created_at DESC, id DESC);
CREATE INDEX work_events_owner ON public.work_events(user_id, created_at DESC);
ALTER TABLE public.work_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY work_events_select ON public.work_events FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
-- Deliberately no INSERT/UPDATE/DELETE policy: rows come only from the history triggers below and are
-- never changed, by owners, agents or the service role.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.work_events FROM PUBLIC, anon, authenticated, service_role;

-- Who caused the current change. Owner and agent sessions are identified by their JWT; service-role
-- requests from Edge Functions say whom they act for in x-textus-actor ('user', 'agent:<token id>' or
-- 'job:<type>'), which user and agent JWTs cannot override. Direct SQL has neither.
CREATE FUNCTION private.event_actor(OUT actor TEXT, OUT detail TEXT) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE claims JSONB := auth.jwt(); headers TEXT := nullif(current_setting('request.headers', true), ''); header TEXT; token UUID;
BEGIN
  IF coalesce(claims->>'textus_agent', 'false') = 'true' THEN
    header := 'agent:' || coalesce(claims->>'textus_token_id', '');
  ELSIF auth.uid() IS NOT NULL THEN
    actor := 'user'; RETURN;
  ELSIF headers IS NOT NULL THEN
    BEGIN header := headers::json->>'x-textus-actor'; EXCEPTION WHEN others THEN header := NULL; END;
  END IF;
  IF header LIKE 'agent:%' THEN
    BEGIN token := substr(header, 7)::uuid; EXCEPTION WHEN others THEN token := NULL; END;
    actor := 'agent'; detail := coalesce((SELECT t.name FROM public.agent_tokens t WHERE t.id = token), 'agent');
  ELSIF header = 'user' THEN
    actor := 'user';
  ELSIF header LIKE 'job:%' THEN
    actor := 'textus'; detail := left(substr(header, 5), 60);
  ELSE
    actor := 'textus'; detail := CASE WHEN headers IS NULL THEN 'database' ELSE 'system' END;
  END IF;
END $$;

CREATE FUNCTION private.log_work_event(p_user UUID, p_work UUID, p_record UUID, p_asset UUID, p_event TEXT, p_summary TEXT,
  p_changes JSONB DEFAULT NULL, p_actor TEXT DEFAULT NULL, p_detail TEXT DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE who RECORD;
BEGIN
  -- Skip work/user rows that are already gone in this transaction (account deletion cascades).
  IF p_user IS NULL OR p_work IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user) THEN RETURN; END IF;
  SELECT * INTO who FROM private.event_actor();
  INSERT INTO public.work_events(user_id, work_id, record_id, asset_id, actor, actor_detail, event, summary, changes)
  VALUES (p_user, p_work, p_record, p_asset, coalesce(p_actor, who.actor), CASE WHEN p_actor IS NULL THEN who.detail ELSE p_detail END,
          p_event, left(p_summary, 500), p_changes);
END $$;

-- Changed columns as {field: {old, new}}; jsonb_changes does the same per top-level key of a JSON column.
-- A JSON null and a missing value are the same here, so added/removed rows list only fields that had values.
CREATE FUNCTION private.row_changes(p_old JSONB, p_new JSONB, p_fields TEXT[]) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT nullif(coalesce(jsonb_object_agg(f, jsonb_strip_nulls(jsonb_build_object('old', p_old->f, 'new', p_new->f))), '{}'), '{}')
  FROM unnest(p_fields) f WHERE nullif(p_old->f, 'null') IS DISTINCT FROM nullif(p_new->f, 'null')
$$;
CREATE FUNCTION private.jsonb_changes(p_prefix TEXT, p_old JSONB, p_new JSONB, p_skip TEXT[]) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT nullif(coalesce(jsonb_object_agg(p_prefix || k, jsonb_build_object('old', coalesce(p_old, '{}')->k, 'new', coalesce(p_new, '{}')->k)), '{}'), '{}')
  FROM (SELECT jsonb_object_keys(coalesce(p_old, '{}')) k UNION SELECT jsonb_object_keys(coalesce(p_new, '{}'))) keys
  WHERE NOT k = ANY(p_skip) AND coalesce(p_old, '{}')->k IS DISTINCT FROM coalesce(p_new, '{}')->k
$$;
CREATE FUNCTION private.field_label(p_field TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_field WHEN 'user_rating' THEN 'rating' WHEN 'metadata_source' THEN 'metadata source' WHEN 'container_record_id' THEN 'container'
    ELSE replace(regexp_replace(p_field, '^metadata\.', ''), '_', ' ') END
$$;
-- "Changed publisher from “A” to “B”" for one short value, otherwise "Changed title, publisher".
CREATE FUNCTION private.change_summary(p_changes JSONB) RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN count(*) = 1 AND bool_and(jsonb_typeof(coalesce(v->'old', 'null')) IN ('string','number','null') AND jsonb_typeof(coalesce(v->'new', 'null')) IN ('string','number','null')
         AND length(coalesce(v->>'old', '')) <= 80 AND length(coalesce(v->>'new', '')) <= 80) THEN
      'Changed ' || max(private.field_label(k)) || CASE
        WHEN max(v->>'old') IS NULL THEN ' to “' || max(v->>'new') || '”'
        WHEN max(v->>'new') IS NULL THEN ' (cleared “' || max(v->>'old') || '”)'
        ELSE ' from “' || max(v->>'old') || '” to “' || max(v->>'new') || '”' END
    ELSE 'Changed ' || string_agg(private.field_label(k), ', ' ORDER BY k) END
  FROM jsonb_each(p_changes) e(k, v)
$$;
CREATE FUNCTION private.record_owner(p_record UUID, OUT user_id UUID, OUT work_id UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT w.user_id, w.id FROM public.records r JOIN public.works w ON w.id = r.work_id WHERE r.id = p_record
$$;
CREATE FUNCTION private.credits_of(p_record UUID) RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('contributor', rc.contributor_id, 'name', coalesce(rc.credited_as, c.display_name), 'role', rc.role, 'position', rc.position)
    ORDER BY rc.role, rc.position), '[]')
  FROM public.record_contributors rc JOIN public.contributors c ON c.id = rc.contributor_id WHERE rc.record_id = p_record
$$;

-- works
CREATE FUNCTION private.history_works() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changes JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM private.log_work_event(NEW.user_id, NEW.id, NULL, NULL, 'work.created', 'Added “' || NEW.title || '” to the library',
      private.row_changes('{}', to_jsonb(NEW), ARRAY['work_type','title','subtitle','language']));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.log_work_event(OLD.user_id, OLD.id, NULL, NULL, 'work.deleted', 'Removed “' || OLD.title || '” from the library',
      private.row_changes(to_jsonb(OLD), '{}', ARRAY['work_type','title','subtitle','abstract','language','user_rating']));
  ELSE
    changes := coalesce(private.row_changes(to_jsonb(OLD), to_jsonb(NEW), ARRAY['work_type','title','subtitle','abstract','language','user_rating']), '{}')
      || coalesce(private.jsonb_changes('metadata.', OLD.metadata, NEW.metadata, ARRAY[]::TEXT[]), '{}');
    IF changes <> '{}' THEN
      PERFORM private.log_work_event(NEW.user_id, NEW.id, NULL, NULL, CASE WHEN changes ?| ARRAY['user_rating'] AND (SELECT count(*) FROM jsonb_object_keys(changes)) = 1 THEN 'work.rated' ELSE 'work.updated' END,
        CASE WHEN changes ?| ARRAY['user_rating'] AND (SELECT count(*) FROM jsonb_object_keys(changes)) = 1
          THEN coalesce('Rated ' || NEW.user_rating || ' ★', 'Cleared the rating') ELSE private.change_summary(changes) END, changes);
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER work_history AFTER INSERT OR UPDATE OR DELETE ON public.works FOR EACH ROW EXECUTE FUNCTION private.history_works();

-- records (editions, versions, issues) and AI/provider suggestions stored on them
CREATE FUNCTION private.history_records() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner UUID; changes JSONB; key TEXT; source TEXT;
BEGIN
  SELECT w.user_id INTO owner FROM public.works w WHERE w.id = coalesce(NEW.work_id, OLD.work_id);
  IF TG_OP = 'INSERT' THEN
    PERFORM private.log_work_event(owner, NEW.work_id, NEW.id, NULL, 'record.created', 'Added ' || replace(NEW.record_type, '_', ' ') || coalesce(' “' || NEW.title || '”', ''),
      private.row_changes('{}', to_jsonb(NEW), ARRAY['record_type','title','publication_date','publisher','edition','volume','issue_number','pages']));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.log_work_event(owner, OLD.work_id, OLD.id, NULL, 'record.deleted', 'Removed ' || replace(OLD.record_type, '_', ' ') || coalesce(' “' || OLD.title || '”', ''),
      private.row_changes(to_jsonb(OLD), '{}', ARRAY['record_type','title','publication_date','publisher','edition','volume','issue_number','pages']));
  ELSE
    IF OLD.work_id IS DISTINCT FROM NEW.work_id THEN
      PERFORM private.log_work_event(owner, NEW.work_id, NEW.id, NULL, 'record.moved', 'Moved ' || replace(NEW.record_type, '_', ' ') || ' here from another work',
        jsonb_build_object('work_id', jsonb_build_object('old', OLD.work_id, 'new', NEW.work_id)));
    END IF;
    -- New suggestions: llm:<model> keys come from the local AI, others from metadata providers.
    FOR key IN SELECT k FROM jsonb_object_keys(coalesce(NEW.metadata->'lookup_suggestions', '{}')) k
      WHERE coalesce(OLD.metadata->'lookup_suggestions'->k, 'null') IS DISTINCT FROM NEW.metadata->'lookup_suggestions'->k LOOP
      IF key LIKE 'llm:%' THEN
        PERFORM private.log_work_event(owner, NEW.work_id, NEW.id, NULL, 'ai.suggested', 'Suggested metadata for your review',
          jsonb_build_object('suggestion', jsonb_build_object('new', NEW.metadata->'lookup_suggestions'->key)), 'ai', substr(key, 5));
      ELSE
        PERFORM private.log_work_event(owner, NEW.work_id, NEW.id, NULL, 'metadata.suggested', 'Found metadata from ' || split_part(key, ':', 1) || ' for your review',
          jsonb_build_object('suggestion', jsonb_build_object('new', NEW.metadata->'lookup_suggestions'->key)));
      END IF;
    END LOOP;
    changes := coalesce(private.row_changes(to_jsonb(OLD), to_jsonb(NEW), ARRAY['record_type','title','publication_date','publication_date_precision','publisher','edition','volume','issue_number','pages','container_record_id','metadata_source']), '{}')
      || coalesce(private.jsonb_changes('metadata.', OLD.metadata, NEW.metadata, ARRAY['lookup_suggestions']), '{}');
    IF changes <> '{}' THEN
      source := CASE WHEN changes ? 'metadata_source' THEN NEW.metadata_source END;
      PERFORM private.log_work_event(owner, NEW.work_id, NEW.id, NULL, 'record.updated',
        CASE WHEN source LIKE 'llm:%' THEN 'Applied the AI suggestion (' || substr(source, 5) || ') — ' || private.change_summary(changes - 'metadata_source')
             WHEN source IS NOT NULL AND changes - 'metadata_source' <> '{}' THEN 'Applied metadata from ' || source || ' — ' || private.change_summary(changes - 'metadata_source')
             ELSE private.change_summary(changes) END, changes);
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER record_history AFTER INSERT OR UPDATE OR DELETE ON public.records FOR EACH ROW EXECUTE FUNCTION private.history_records();

-- credits: set_record_contributors() replaces every credit on save, so the first change in a transaction
-- snapshots the record's credits and a deferred trigger logs the net difference once, at commit.
-- The actor is captured with the snapshot: the deferred log runs at commit, when request settings may differ.
CREATE UNLOGGED TABLE private.credit_snapshots (txid BIGINT NOT NULL, record_id UUID NOT NULL, credits JSONB NOT NULL, actor TEXT NOT NULL, detail TEXT, PRIMARY KEY (txid, record_id));
REVOKE ALL ON private.credit_snapshots FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION private.snapshot_credits() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO private.credit_snapshots(txid, record_id, credits, actor, detail)
  SELECT txid_current(), coalesce(NEW.record_id, OLD.record_id), private.credits_of(coalesce(NEW.record_id, OLD.record_id)), who.actor, who.detail FROM private.event_actor() who
  ON CONFLICT DO NOTHING;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER credit_snapshot BEFORE INSERT OR UPDATE OR DELETE ON public.record_contributors FOR EACH ROW EXECUTE FUNCTION private.snapshot_credits();
CREATE FUNCTION private.history_credits() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rec UUID := coalesce(NEW.record_id, OLD.record_id); snap private.credit_snapshots; before JSONB; after JSONB; owner RECORD; added TEXT; removed TEXT;
BEGIN
  DELETE FROM private.credit_snapshots s WHERE s.txid = txid_current() AND s.record_id = rec RETURNING s.* INTO snap;
  IF snap.record_id IS NULL THEN RETURN NULL; END IF; -- already logged for this record in this transaction
  before := snap.credits;
  after := private.credits_of(rec);
  IF before = after THEN RETURN NULL; END IF;
  SELECT * INTO owner FROM private.record_owner(rec);
  SELECT string_agg(x->>'role' || ' ' || (x->>'name'), ', ') INTO added FROM jsonb_array_elements(after) x
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(before) y WHERE y->>'contributor' = x->>'contributor' AND y->>'role' = x->>'role');
  SELECT string_agg(x->>'role' || ' ' || (x->>'name'), ', ') INTO removed FROM jsonb_array_elements(before) x
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(after) y WHERE y->>'contributor' = x->>'contributor' AND y->>'role' = x->>'role');
  PERFORM private.log_work_event(owner.user_id, owner.work_id, rec, NULL, 'credits.updated',
    CASE WHEN added IS NULL AND removed IS NULL THEN 'Reordered or renamed credits'
      ELSE concat_ws('; ', 'Added ' || added, 'Removed ' || removed) END,
    jsonb_build_object('credits', jsonb_build_object('old', before, 'new', after)), snap.actor, snap.detail);
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER credit_history AFTER INSERT OR UPDATE OR DELETE ON public.record_contributors DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.history_credits();

-- identifiers
CREATE FUNCTION private.history_identifiers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner RECORD; changes JSONB;
BEGIN
  SELECT * INTO owner FROM private.record_owner(coalesce(NEW.record_id, OLD.record_id));
  IF TG_OP = 'INSERT' THEN
    PERFORM private.log_work_event(owner.user_id, owner.work_id, NEW.record_id, NULL, 'identifier.added', 'Added ' || upper(NEW.scheme) || ' ' || NEW.normalized_value,
      jsonb_build_object(NEW.scheme, jsonb_build_object('new', NEW.normalized_value)));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.log_work_event(owner.user_id, owner.work_id, OLD.record_id, NULL, 'identifier.removed', 'Removed ' || upper(OLD.scheme) || ' ' || OLD.normalized_value,
      jsonb_build_object(OLD.scheme, jsonb_build_object('old', OLD.normalized_value)));
  ELSE
    changes := private.row_changes(to_jsonb(OLD), to_jsonb(NEW), ARRAY['scheme','normalized_value','original_value','is_primary']);
    IF changes IS NOT NULL THEN
      PERFORM private.log_work_event(owner.user_id, owner.work_id, NEW.record_id, NULL, 'identifier.updated', 'Updated ' || upper(NEW.scheme) || ' ' || NEW.normalized_value, changes);
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER identifier_history AFTER INSERT OR UPDATE OR DELETE ON public.identifiers FOR EACH ROW EXECUTE FUNCTION private.history_identifiers();

-- files linked to records
CREATE FUNCTION private.history_record_assets() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner RECORD; link public.record_assets := coalesce(NEW, OLD); asset public.assets; label TEXT;
BEGIN
  SELECT * INTO owner FROM private.record_owner(link.record_id);
  SELECT * INTO asset FROM public.assets a WHERE a.id = link.asset_id;
  label := CASE link.role WHEN 'primary' THEN 'file' WHEN 'cover' THEN 'cover image' ELSE link.role || ' file' END
    || coalesce(' “' || (asset.metadata->>'filename') || '”', '') || coalesce(' (' || upper(asset.file_format) || ', ' || pg_size_pretty(asset.file_size) || ')', '');
  IF TG_OP = 'INSERT' THEN
    PERFORM private.log_work_event(owner.user_id, owner.work_id, link.record_id, link.asset_id, 'file.added', 'Added ' || label,
      jsonb_build_object('file', jsonb_build_object('new', jsonb_build_object('role', link.role, 'format', asset.file_format, 'size', asset.file_size, 'sha256', asset.checksum_sha256))));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.log_work_event(owner.user_id, owner.work_id, link.record_id, link.asset_id, 'file.removed', 'Removed ' || label,
      jsonb_build_object('file', jsonb_build_object('old', jsonb_build_object('role', link.role, 'format', asset.file_format, 'size', asset.file_size, 'sha256', asset.checksum_sha256))));
  ELSIF OLD.role IS DISTINCT FROM NEW.role THEN
    PERFORM private.log_work_event(owner.user_id, owner.work_id, link.record_id, link.asset_id, 'file.updated', 'Changed a file from ' || OLD.role || ' to ' || NEW.role,
      jsonb_build_object('role', jsonb_build_object('old', OLD.role, 'new', NEW.role)));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER file_history AFTER INSERT OR UPDATE OR DELETE ON public.record_assets FOR EACH ROW EXECUTE FUNCTION private.history_record_assets();

-- processing milestones: text extraction, full-text indexing, embeddings, deletion. Checkpoints are progress,
-- not history; only state transitions are logged, for every work the file belongs to.
CREATE FUNCTION private.history_assets() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target RECORD; event TEXT; summary TEXT; changes JSONB; idx JSONB := NEW.metadata->'passage_index'; emb JSONB := NEW.metadata->'embedding_index';
BEGIN
  IF OLD.processing_state IS DISTINCT FROM NEW.processing_state AND NEW.processing_state IN ('ready','failed') THEN
    event := 'file.read'; summary := CASE NEW.processing_state WHEN 'ready' THEN 'Read the file and its text' ELSE 'Could not read the file' || coalesce(': ' || NEW.processing_error, '') END;
    changes := jsonb_build_object('processing_state', jsonb_build_object('old', OLD.processing_state, 'new', NEW.processing_state));
  ELSIF OLD.metadata->'passage_index'->>'status' IS DISTINCT FROM idx->>'status' AND idx->>'status' IS NOT NULL THEN
    event := 'index.' || (idx->>'status');
    summary := CASE idx->>'status'
      WHEN 'queued' THEN 'Queued for full-text indexing'
      WHEN 'indexing' THEN 'Started full-text indexing'
      WHEN 'complete' THEN 'Full text indexed: ' || coalesce(idx->>'total', '?') || ' pages or sections, ' || coalesce(idx->>'passages', '?') || ' passages'
      WHEN 'partial' THEN 'Indexed part of the text: ' || coalesce(idx->>'reason', 'a parser limit was reached')
      WHEN 'no_text' THEN 'No text layer found (likely a scan); full-text search needs OCR'
      WHEN 'not_indexable' THEN 'Could not index this file: ' || coalesce(idx->>'reason', 'unsupported content')
      WHEN 'failed' THEN 'Full-text indexing failed; retry continues from the last checkpoint'
      WHEN 'cancelled' THEN 'Full-text indexing cancelled'
      ELSE 'Indexing ' || (idx->>'status') END;
    changes := jsonb_build_object('passage_index', jsonb_build_object('old', OLD.metadata->'passage_index', 'new', idx));
  ELSIF emb->>'status' = 'complete' AND (OLD.metadata->'embedding_index'->>'status' IS DISTINCT FROM 'complete' OR OLD.metadata->'embedding_index'->>'digest' IS DISTINCT FROM emb->>'digest') THEN
    event := 'embedding.complete'; summary := 'Ready for AI and cross-language search' || coalesce(' (' || (emb->>'embedded') || ' passages)', '');
    changes := jsonb_build_object('embedding_index', jsonb_build_object('old', OLD.metadata->'embedding_index', 'new', emb));
  ELSIF OLD.deleting_at IS NULL AND NEW.deleting_at IS NOT NULL THEN
    event := 'file.deleting'; summary := 'File scheduled for deletion';
  ELSE
    RETURN NULL;
  END IF;
  FOR target IN SELECT DISTINCT w.user_id, w.id work_id, ra.record_id FROM public.record_assets ra JOIN public.records r ON r.id = ra.record_id JOIN public.works w ON w.id = r.work_id WHERE ra.asset_id = NEW.id LOOP
    PERFORM private.log_work_event(target.user_id, target.work_id, target.record_id, NEW.id, event, summary, changes);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER asset_history AFTER UPDATE ON public.assets FOR EACH ROW
  WHEN (OLD.processing_state IS DISTINCT FROM NEW.processing_state OR OLD.deleting_at IS DISTINCT FROM NEW.deleting_at
    OR OLD.metadata->'passage_index'->>'status' IS DISTINCT FROM NEW.metadata->'passage_index'->>'status'
    OR OLD.metadata->'embedding_index' IS DISTINCT FROM NEW.metadata->'embedding_index')
  EXECUTE FUNCTION private.history_assets();

-- tags and collections on a record
CREATE FUNCTION private.history_record_tags() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner RECORD; link public.record_tags := coalesce(NEW, OLD); name TEXT;
BEGIN
  SELECT * INTO owner FROM private.record_owner(link.record_id);
  SELECT t.name INTO name FROM public.tags t WHERE t.id = link.tag_id;
  PERFORM private.log_work_event(owner.user_id, owner.work_id, link.record_id, NULL, CASE TG_OP WHEN 'INSERT' THEN 'tag.added' ELSE 'tag.removed' END,
    CASE TG_OP WHEN 'INSERT' THEN 'Tagged “' ELSE 'Removed tag “' END || coalesce(name, 'deleted tag') || '”',
    jsonb_build_object('tag', jsonb_build_object(CASE TG_OP WHEN 'INSERT' THEN 'new' ELSE 'old' END, name)));
  RETURN NULL;
END $$;
CREATE TRIGGER record_tag_history AFTER INSERT OR DELETE ON public.record_tags FOR EACH ROW EXECUTE FUNCTION private.history_record_tags();
CREATE FUNCTION private.history_collection_records() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner RECORD; link public.collection_records := coalesce(NEW, OLD); name TEXT;
BEGIN
  SELECT * INTO owner FROM private.record_owner(link.record_id);
  SELECT c.name INTO name FROM public.collections c WHERE c.id = link.collection_id;
  PERFORM private.log_work_event(owner.user_id, owner.work_id, link.record_id, NULL, CASE TG_OP WHEN 'INSERT' THEN 'collection.added' ELSE 'collection.removed' END,
    CASE TG_OP WHEN 'INSERT' THEN 'Added to collection “' ELSE 'Removed from collection “' END || coalesce(name, 'deleted collection') || '”',
    jsonb_build_object('collection', jsonb_build_object(CASE TG_OP WHEN 'INSERT' THEN 'new' ELSE 'old' END, name)));
  RETURN NULL;
END $$;
CREATE TRIGGER collection_record_history AFTER INSERT OR DELETE ON public.collection_records FOR EACH ROW EXECUTE FUNCTION private.history_collection_records();

-- renaming a tag, collection or contributor changes how every attached book reads
CREATE FUNCTION private.history_shared_names() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target RECORD; kind TEXT := CASE TG_TABLE_NAME WHEN 'tags' THEN 'Tag' WHEN 'collections' THEN 'Collection' ELSE 'Contributor' END;
  old_name TEXT := CASE TG_TABLE_NAME WHEN 'contributors' THEN to_jsonb(OLD)->>'display_name' ELSE to_jsonb(OLD)->>'name' END;
  new_name TEXT := CASE TG_TABLE_NAME WHEN 'contributors' THEN to_jsonb(NEW)->>'display_name' ELSE to_jsonb(NEW)->>'name' END;
BEGIN
  IF old_name IS NOT DISTINCT FROM new_name THEN RETURN NULL; END IF;
  FOR target IN
    SELECT DISTINCT w.user_id, w.id work_id FROM public.records r JOIN public.works w ON w.id = r.work_id
    WHERE (TG_TABLE_NAME = 'tags' AND r.id IN (SELECT rt.record_id FROM public.record_tags rt WHERE rt.tag_id = NEW.id))
       OR (TG_TABLE_NAME = 'collections' AND r.id IN (SELECT cr.record_id FROM public.collection_records cr WHERE cr.collection_id = NEW.id))
       OR (TG_TABLE_NAME = 'contributors' AND r.id IN (SELECT rc.record_id FROM public.record_contributors rc WHERE rc.contributor_id = NEW.id))
  LOOP
    PERFORM private.log_work_event(target.user_id, target.work_id, NULL, NULL, lower(kind) || '.renamed', kind || ' “' || old_name || '” renamed to “' || new_name || '”',
      jsonb_build_object(lower(kind), jsonb_build_object('old', old_name, 'new', new_name)));
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER tag_name_history AFTER UPDATE OF name ON public.tags FOR EACH ROW EXECUTE FUNCTION private.history_shared_names();
CREATE TRIGGER collection_name_history AFTER UPDATE OF name ON public.collections FOR EACH ROW EXECUTE FUNCTION private.history_shared_names();
CREATE TRIGGER contributor_name_history AFTER UPDATE OF display_name ON public.contributors FOR EACH ROW EXECUTE FUNCTION private.history_shared_names();

-- highlights, notes and their tags
CREATE FUNCTION private.history_annotations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner RECORD; a public.annotations := coalesce(NEW, OLD); place TEXT; what TEXT; changes JSONB;
BEGIN
  SELECT * INTO owner FROM private.record_owner(a.record_id);
  place := coalesce(' on page ' || (a.anchor_data->>'page'), '');
  what := CASE WHEN a.note IS NOT NULL AND a.highlighted_text IS NULL THEN 'note' ELSE 'highlight' END;
  IF TG_OP = 'INSERT' THEN
    PERFORM private.log_work_event(owner.user_id, owner.work_id, a.record_id, a.asset_id, 'annotation.added',
      'Added a ' || what || place || coalesce(': “' || left(a.highlighted_text, 120) || '”', ''),
      private.row_changes('{}', to_jsonb(NEW), ARRAY['highlighted_text','note','color']));
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM private.log_work_event(owner.user_id, owner.work_id, a.record_id, a.asset_id, 'annotation.removed',
      'Removed a ' || what || place || coalesce(': “' || left(a.highlighted_text, 120) || '”', ''),
      private.row_changes(to_jsonb(OLD), '{}', ARRAY['highlighted_text','note','color','anchor_data']));
  ELSE
    changes := private.row_changes(to_jsonb(OLD), to_jsonb(NEW), ARRAY['highlighted_text','note','color','anchor_data']);
    IF changes IS NOT NULL THEN
      PERFORM private.log_work_event(owner.user_id, owner.work_id, a.record_id, a.asset_id, 'annotation.updated',
        CASE WHEN changes ? 'note' THEN 'Edited a note' ELSE 'Edited a highlight' END || place, changes);
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER annotation_history AFTER INSERT OR UPDATE OR DELETE ON public.annotations FOR EACH ROW EXECUTE FUNCTION private.history_annotations();
CREATE FUNCTION private.history_annotation_tags() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner RECORD; link public.annotation_tags := coalesce(NEW, OLD); a public.annotations; name TEXT;
BEGIN
  SELECT * INTO a FROM public.annotations x WHERE x.id = link.annotation_id;
  IF a.id IS NULL THEN RETURN NULL; END IF; -- removed together with its annotation
  SELECT * INTO owner FROM private.record_owner(a.record_id);
  SELECT t.name INTO name FROM public.tags t WHERE t.id = link.tag_id;
  PERFORM private.log_work_event(owner.user_id, owner.work_id, a.record_id, a.asset_id, CASE TG_OP WHEN 'INSERT' THEN 'annotation.tagged' ELSE 'annotation.untagged' END,
    CASE TG_OP WHEN 'INSERT' THEN 'Tagged a highlight “' ELSE 'Removed tag from a highlight “' END || coalesce(name, 'deleted tag') || '”',
    jsonb_build_object('tag', jsonb_build_object(CASE TG_OP WHEN 'INSERT' THEN 'new' ELSE 'old' END, name)));
  RETURN NULL;
END $$;
CREATE TRIGGER annotation_tag_history AFTER INSERT OR DELETE ON public.annotation_tags FOR EACH ROW EXECUTE FUNCTION private.history_annotation_tags();

-- reading: status changes and 25/50/75/100% milestones, not every saved position
CREATE FUNCTION private.history_reading() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner RECORD; old_step INT; new_step INT;
BEGIN
  SELECT * INTO owner FROM private.record_owner(NEW.record_id);
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    IF TG_OP = 'INSERT' AND NEW.status = 'unread' THEN RETURN NULL; END IF;
    PERFORM private.log_work_event(owner.user_id, owner.work_id, NEW.record_id, NEW.asset_id, 'reading.status',
      CASE NEW.status WHEN 'reading' THEN 'Started reading' WHEN 'finished' THEN 'Finished reading' WHEN 'abandoned' THEN 'Stopped reading' ELSE 'Marked as unread' END,
      jsonb_build_object('status', jsonb_build_object('old', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, 'new', NEW.status)));
  END IF;
  old_step := CASE WHEN TG_OP = 'UPDATE' THEN floor(coalesce(OLD.progress_percentage, 0) / 25) END;
  new_step := floor(coalesce(NEW.progress_percentage, 0) / 25);
  IF new_step > coalesce(old_step, 0) THEN
    PERFORM private.log_work_event(owner.user_id, owner.work_id, NEW.record_id, NEW.asset_id, 'reading.progress', 'Read ' || (new_step * 25) || '%',
      jsonb_build_object('progress_percentage', jsonb_build_object('old', CASE WHEN TG_OP = 'UPDATE' THEN OLD.progress_percentage END, 'new', NEW.progress_percentage)));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER reading_history AFTER INSERT OR UPDATE ON public.reading_states FOR EACH ROW EXECUTE FUNCTION private.history_reading();

-- agent proposals, approvals and execution (the resulting catalog changes are logged by the triggers above)
CREATE FUNCTION private.history_agent_actions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE work UUID; rec UUID; agent TEXT; label TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NULL; END IF;
  -- read_write tokens are approved on request (migration 20261001000039); only the completed change is history.
  IF TG_OP = 'INSERT' AND NEW.status = 'approved' THEN RETURN NULL; END IF;
  BEGIN rec := nullif(NEW.arguments->>'recordId', '')::uuid; work := coalesce(nullif(NEW.arguments->>'workId', '')::uuid, nullif(NEW.result->>'workId', '')::uuid); EXCEPTION WHEN others THEN RETURN NULL; END;
  IF work IS NULL AND rec IS NOT NULL THEN SELECT r.work_id INTO work FROM public.records r WHERE r.id = rec; END IF;
  IF work IS NULL OR NOT EXISTS (SELECT 1 FROM public.works w WHERE w.id = work AND w.user_id = NEW.user_id) THEN RETURN NULL; END IF;
  agent := coalesce((SELECT t.name FROM public.agent_tokens t WHERE t.id = NEW.token_id), 'agent');
  label := CASE NEW.tool WHEN 'tag_work' THEN 'tag this book' WHEN 'add_to_collection' THEN 'add this book to a collection'
    WHEN 'add_file_from_url' THEN 'add a file from ' || coalesce(NEW.arguments->>'url', 'a URL') ELSE 'create this book from an identifier' END;
  PERFORM private.log_work_event(NEW.user_id, work, rec, NULL, 'agent.' || NEW.status,
    CASE NEW.status WHEN 'pending' THEN agent || ' proposed to ' || label WHEN 'approved' THEN 'Approved ' || agent || ' to ' || label
      WHEN 'rejected' THEN 'Rejected ' || agent || '’s proposal to ' || label ELSE agent || ' carried out a request to ' || label END,
    jsonb_build_object('proposal', jsonb_build_object('new', jsonb_build_object('tool', NEW.tool, 'arguments', NEW.arguments, 'status', NEW.status))),
    CASE WHEN NEW.status IN ('approved','rejected') THEN 'user' ELSE 'agent' END, CASE WHEN NEW.status IN ('approved','rejected') THEN NULL ELSE agent END);
  RETURN NULL;
END $$;
CREATE TRIGGER agent_action_history AFTER INSERT OR UPDATE OF status ON public.agent_actions FOR EACH ROW EXECUTE FUNCTION private.history_agent_actions();

-- background steps that failed for good (indexing failures are logged from the file's state above)
CREATE FUNCTION private.history_failed_jobs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target RECORD; rec UUID; asset UUID;
BEGIN
  BEGIN rec := nullif(NEW.payload->>'record_id', '')::uuid; asset := nullif(NEW.payload->>'asset_id', '')::uuid; EXCEPTION WHEN others THEN RETURN NULL; END;
  FOR target IN
    SELECT DISTINCT w.user_id, w.id work_id, r.id record_id FROM public.records r JOIN public.works w ON w.id = r.work_id
    WHERE r.id = rec OR r.id IN (SELECT ra.record_id FROM public.record_assets ra WHERE ra.asset_id = asset)
  LOOP
    PERFORM private.log_work_event(target.user_id, target.work_id, target.record_id, asset, 'job.failed',
      CASE NEW.job_type WHEN 'fetch_metadata' THEN 'Metadata lookup failed' WHEN 'process_cover' THEN 'Could not fetch the cover image'
        WHEN 'extract_metadata_ai' THEN 'AI metadata suggestion failed' WHEN 'extract_text' THEN 'Could not read the file' ELSE replace(NEW.job_type, '_', ' ') || ' failed' END
        || coalesce(': ' || left(NEW.last_error, 200), ''),
      jsonb_build_object('job', jsonb_build_object('new', jsonb_build_object('type', NEW.job_type, 'attempts', NEW.attempts, 'error', NEW.last_error))),
      'textus', NEW.job_type);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER failed_job_history AFTER UPDATE OF status ON public.jobs FOR EACH ROW
  WHEN (NEW.status = 'failed' AND OLD.status IS DISTINCT FROM 'failed' AND NEW.job_type IN ('fetch_metadata','process_cover','extract_metadata_ai','extract_text'))
  EXECUTE FUNCTION private.history_failed_jobs();

REVOKE ALL ON FUNCTION private.event_actor(), private.log_work_event(UUID,UUID,UUID,UUID,TEXT,TEXT,JSONB,TEXT,TEXT), private.row_changes(JSONB,JSONB,TEXT[]),
  private.jsonb_changes(TEXT,JSONB,JSONB,TEXT[]), private.field_label(TEXT), private.change_summary(JSONB), private.record_owner(UUID), private.credits_of(UUID),
  private.history_works(), private.history_records(), private.snapshot_credits(), private.history_credits(), private.history_identifiers(), private.history_record_assets(),
  private.history_assets(), private.history_record_tags(), private.history_collection_records(), private.history_shared_names(), private.history_annotations(),
  private.history_annotation_tags(), private.history_reading(), private.history_agent_actions(), private.history_failed_jobs() FROM PUBLIC, anon, authenticated;

-- History starts now; earlier books get their known starting points.
INSERT INTO public.work_events(user_id, work_id, actor, actor_detail, event, summary, changes, created_at)
SELECT w.user_id, w.id, 'textus', 'history start', 'work.created', 'Added “' || w.title || '” to the library (recorded when history began)',
  jsonb_build_object('title', jsonb_build_object('new', w.title)), coalesce(w.created_at, now())
FROM public.works w;
INSERT INTO public.work_events(user_id, work_id, record_id, asset_id, actor, actor_detail, event, summary, created_at)
SELECT w.user_id, w.id, ra.record_id, ra.asset_id, 'textus', 'history start', 'file.added',
  'Added ' || CASE ra.role WHEN 'primary' THEN 'file' WHEN 'cover' THEN 'cover image' ELSE ra.role || ' file' END || ' (' || upper(a.file_format) || ', ' || pg_size_pretty(a.file_size) || ')',
  coalesce(ra.created_at, a.created_at, now())
FROM public.record_assets ra JOIN public.assets a ON a.id = ra.asset_id JOIN public.records r ON r.id = ra.record_id JOIN public.works w ON w.id = r.work_id;
