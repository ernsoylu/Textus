-- Schema: extensions, private schema, 18 tables. Source: ARCHITECTURE_AND_REQUIREMENTS.md §7.1
-- ==========================================
-- EXTENSIONS AND SCHEMAS
-- ==========================================
-- gen_random_uuid() is built into PostgreSQL 13+; no uuid-ossp/pgcrypto needed.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Not exposed through the API; holds helpers used by RLS policies.
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

-- ==========================================
-- 1. WORKS (intellectual content)
-- ==========================================
CREATE TABLE works (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    work_type TEXT NOT NULL CHECK (work_type IN ('book', 'article', 'chapter', 'serial', 'thesis', 'report', 'other')),
    title TEXT NOT NULL,
    subtitle TEXT,
    abstract TEXT,
    language TEXT DEFAULT 'en',
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(subtitle, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(abstract, '')), 'C')
    ) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_works_user ON works(user_id);
CREATE INDEX idx_works_type ON works(work_type);
CREATE INDEX idx_works_search ON works USING GIN(search_vector);
CREATE INDEX idx_works_title_trgm ON works USING GIN(title gin_trgm_ops);

-- ==========================================
-- 2. RECORDS (specific manifestations)
-- ==========================================
CREATE TABLE records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    -- Part-of: chapter → edited volume's record, article → issue record (§6.3)
    container_record_id UUID REFERENCES records(id) ON DELETE SET NULL CHECK (container_record_id <> id),
    record_type TEXT NOT NULL CHECK (record_type IN (
        'edition',          -- Book edition
        'article_version',  -- Article (preprint, published, etc.)
        'chapter',          -- Chapter in an edited volume / proceedings
        'issue',            -- Magazine/journal issue
        'report',           -- Standalone report
        'thesis',           -- Thesis/dissertation
        'other'
    )),
    title TEXT, -- May differ from work title (e.g., article title, issue theme)
    publication_date DATE,
    publication_date_precision TEXT CHECK (publication_date_precision IN ('year', 'month', 'day')),
    publisher TEXT,
    edition TEXT,
    volume TEXT,
    issue_number TEXT,
    pages TEXT, -- e.g., "123-145" or "e01234"
    metadata JSONB DEFAULT '{}', -- Type-specific extras: container_title, locked_fields (FR-META-3), contributors_incomplete
    metadata_source TEXT,
    metadata_fetched_at TIMESTAMPTZ,
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(metadata::text, '')), 'B')
    ) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_records_work ON records(work_id);
CREATE INDEX idx_records_container ON records(container_record_id) WHERE container_record_id IS NOT NULL;
CREATE INDEX idx_records_type ON records(record_type);
CREATE INDEX idx_records_search ON records USING GIN(search_vector);
CREATE INDEX idx_records_metadata ON records USING GIN(metadata);

-- ==========================================
-- 3. IDENTIFIERS (normalized, see §6.2)
-- ==========================================
CREATE TABLE identifiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id UUID NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    scheme TEXT NOT NULL CHECK (scheme IN ('isbn', 'doi', 'issn', 'arxiv', 'pmid')),
    normalized_value TEXT NOT NULL,
    original_value TEXT,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(record_id, scheme, normalized_value)
);

CREATE INDEX idx_identifiers_record ON identifiers(record_id);
CREATE INDEX idx_identifiers_scheme_value ON identifiers(scheme, normalized_value);

-- ==========================================
-- 4. CONTRIBUTORS (identities: people and organizations, §6.3)
-- ==========================================
CREATE TABLE contributors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'organization')),
    display_name TEXT NOT NULL,  -- preferred form: "J. R. R. Tolkien", "Siemens PLM Software"
    family_name TEXT,            -- persons: "Tolkien"; mononyms use this only
    given_names TEXT,            -- "John Ronald Reuel"
    particle TEXT,               -- "van", "Le"
    suffix TEXT,                 -- "Jr.", "III"
    sort_name TEXT NOT NULL,     -- "Tolkien, John Ronald Reuel"; organizations: display_name
    match_key TEXT NOT NULL,     -- shared/names.ts fold(): family name without particle, or full org name
    birth_year SMALLINT,
    death_year SMALLINT,
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'provisional')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (kind = 'organization' OR family_name IS NOT NULL)
    -- Deliberately no UNIQUE on names: different people share names.
);

CREATE INDEX idx_contributors_match ON contributors(user_id, match_key);
CREATE INDEX idx_contributors_provisional ON contributors(user_id) WHERE status = 'provisional';
CREATE INDEX idx_contributors_name_trgm ON contributors USING GIN(display_name gin_trgm_ops);

-- 4a. Other names of a contributor
CREATE TABLE contributor_names (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    contributor_id UUID NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    match_key TEXT NOT NULL,
    name_type TEXT NOT NULL DEFAULT 'variant' CHECK (name_type IN ('variant', 'pseudonym', 'transliteration', 'former')),
    UNIQUE(contributor_id, name)
);

CREATE INDEX idx_contributor_names_match ON contributor_names(user_id, match_key);
CREATE INDEX idx_contributor_names_trgm ON contributor_names USING GIN(name gin_trgm_ops);

-- 4b. External authority identifiers (normalized per §6.2)
CREATE TABLE contributor_identifiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    contributor_id UUID NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
    scheme TEXT NOT NULL CHECK (scheme IN ('orcid', 'isni', 'viaf', 'wikidata', 'openlibrary', 'semantic_scholar')),
    value TEXT NOT NULL,
    UNIQUE(user_id, scheme, value) -- one external identity = one contributor per library
);

CREATE INDEX idx_contributor_identifiers_contributor ON contributor_identifiers(contributor_id);

-- 4c. "Not the same person" decisions, so the review queue does not repeat itself
CREATE TABLE contributor_distinctions (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    contributor_a UUID NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
    contributor_b UUID NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (contributor_a, contributor_b),
    CHECK (contributor_a < contributor_b)
);

CREATE INDEX idx_contributor_distinctions_b ON contributor_distinctions(contributor_b);

-- ==========================================
-- 5. RECORD_CONTRIBUTORS (credits)
-- ==========================================
CREATE TABLE record_contributors (
    record_id UUID NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    contributor_id UUID NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'author' CHECK (role IN (
        'author', 'editor', 'compiler', 'translator', 'illustrator', 'series_editor', 'introduction', 'contributor')),
    position INTEGER NOT NULL CHECK (position >= 0), -- order within the role on this record
    credited_as TEXT,   -- name as printed on this record, when it differs from display_name
    affiliation TEXT,   -- as printed at publication (papers); matching evidence
    resolved_by TEXT NOT NULL DEFAULT 'user' CHECK (resolved_by IN ('user', 'identifier', 'match', 'new')),
    PRIMARY KEY (record_id, contributor_id, role),
    UNIQUE (record_id, role, position)
);

CREATE INDEX idx_record_contributors_contributor ON record_contributors(contributor_id);

-- ==========================================
-- 6. ASSETS (immutable file bytes, server-managed)
-- ==========================================
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    bucket TEXT NOT NULL CHECK (bucket IN ('documents', 'covers')),
    storage_path TEXT NOT NULL, -- '{user_id}/{sha256}.{ext}' (content-addressed)
    file_size BIGINT NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    mime_type TEXT NOT NULL, -- detected server-side from bytes
    file_format TEXT NOT NULL CHECK (file_format IN ('pdf', 'epub', 'mobi', 'azw3', 'cbz', 'html', 'txt', 'image')),
    processing_state TEXT NOT NULL DEFAULT 'pending' CHECK (processing_state IN ('pending', 'processing', 'ready', 'failed')),
    processing_error TEXT,
    metadata JSONB DEFAULT '{}', -- page count, dimensions, extracted-text info, etc.
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, checksum_sha256) -- dedup + upload idempotency (FR-FILE-3)
);

CREATE INDEX idx_assets_state ON assets(processing_state);

-- ==========================================
-- 7. RECORD_ASSETS (junction with roles)
-- ==========================================
CREATE TABLE record_assets (
    record_id UUID NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'supplement', 'cover', 'converted', 'thumbnail')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (record_id, asset_id, role)
);

CREATE INDEX idx_record_assets_asset ON record_assets(asset_id);

-- ==========================================
-- 8. TAGS
-- ==========================================
CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

-- ==========================================
-- 9. RECORD_TAGS (junction)
-- ==========================================
CREATE TABLE record_tags (
    record_id UUID NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (record_id, tag_id)
);

CREATE INDEX idx_record_tags_tag ON record_tags(tag_id);

-- ==========================================
-- 10. COLLECTIONS (shelves)
-- ==========================================
CREATE TABLE collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    cover_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_collections_user ON collections(user_id);

-- ==========================================
-- 11. COLLECTION_RECORDS (junction)
-- ==========================================
CREATE TABLE collection_records (
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    record_id UUID NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 0,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (collection_id, record_id)
);

CREATE INDEX idx_collection_records_record ON collection_records(record_id);

-- ==========================================
-- 12. READING_STATES (progress tracking)
-- ==========================================
CREATE TABLE reading_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    record_id UUID NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL, -- which format is being read
    progress_percentage DECIMAL(5,2) DEFAULT 0 CHECK (progress_percentage BETWEEN 0 AND 100),
    current_page INTEGER,
    current_position JSONB, -- EPUB: {cfi: "..."} | PDF: {page: 5, scrollY: 0.5}
    status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'reading', 'finished', 'abandoned')),
    last_read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, record_id)
);

CREATE INDEX idx_reading_states_record ON reading_states(record_id);
CREATE INDEX idx_reading_states_status ON reading_states(user_id, status);

-- ==========================================
-- 13. ANNOTATIONS (highlights/notes)
-- ==========================================
CREATE TABLE annotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    record_id UUID NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE, -- anchored to specific bytes
    anchor_type TEXT NOT NULL CHECK (anchor_type IN ('pdf_page', 'epub_cfi', 'text_quote')),
    anchor_data JSONB NOT NULL, -- {page, rects:[{x1,y1,x2,y2}]} | {cfi} | {quote, context}
    highlighted_text TEXT,
    note TEXT,
    color TEXT DEFAULT 'yellow',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_annotations_user ON annotations(user_id);
CREATE INDEX idx_annotations_record ON annotations(record_id);
CREATE INDEX idx_annotations_asset ON annotations(asset_id);

-- ==========================================
-- 14. METADATA_CACHE (shared across users; public data only)
-- ==========================================
CREATE TABLE metadata_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier_scheme TEXT NOT NULL,
    identifier_value TEXT NOT NULL, -- normalized
    provider TEXT NOT NULL,
    response_data JSONB NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ, -- NULL = no expiry
    UNIQUE(identifier_scheme, identifier_value, provider)
);

-- ==========================================
-- 15. JOBS (background processing queue)
-- ==========================================
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL for system jobs
    job_type TEXT NOT NULL CHECK (job_type IN (
        'extract_text',
        'generate_thumbnail',
        'fetch_metadata',
        'process_cover',
        'export_data',
        'cleanup'           -- orphaned staging files and unreferenced assets
    )),
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    last_error TEXT,
    result JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    lease_expires_at TIMESTAMPTZ,
    idempotency_key TEXT UNIQUE -- e.g. 'extract_text:{asset_id}'
);

CREATE INDEX idx_jobs_user ON jobs(user_id);
CREATE INDEX idx_jobs_queue ON jobs(created_at) WHERE status = 'queued';
CREATE INDEX idx_jobs_lease ON jobs(lease_expires_at) WHERE status = 'running';
