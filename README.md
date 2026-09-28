# Textus

> Self-hosted library manager for books, research papers, and magazines.

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Self--hosted-green)](https://supabase.com/docs/guides/self-hosting)

> **Status:** pre-alpha. This repository currently holds the specification; implementation starts with milestone M1.
> The full specification lives in [ARCHITECTURE_AND_REQUIREMENTS.md](ARCHITECTURE_AND_REQUIREMENTS.md).

## What is Textus?

Textus is a web-based personal library manager for **books**, **scientific papers**, and **magazines** with proper bibliographic modeling. Unlike generic file managers or simple ebook readers, Textus understands the difference between a work, its editions, and the files you own.

### Key differentiators

- **Proper domain model** — separates intellectual works from specific editions and from file assets
- **Multi-format** — one book can have PDF, EPUB, and MOBI files
- **Research-ready** — DOI, arXiv, and PMID lookup with citation export
- **Magazine-aware** — serial/issue relationships with completeness tracking
- **Self-hosted** — your data stays on your infrastructure

---

## Features

### Document management
- [ ] Upload PDF, EPUB, MOBI with server-side format detection
- [ ] Automatic metadata retrieval via ISBN, DOI, arXiv, ISSN
- [ ] Manual metadata entry with validation
- [ ] Multiple file formats per record
- [ ] Cover extraction from files or retrieval from providers
- [ ] Duplicate detection (by identifier or file checksum)

### Authors and contributors
- [ ] Contributors are identities, not name strings — two people named "John Smith" stay separate, and "J. Smith" / "Smith, John A." can be linked to one person
- [ ] Roles per credit: author, editor, compiler, translator, illustrator, series editor, introduction
- [ ] Edited volumes: bylines and citations fall back to editors when there are no authors; chapters link to their volume
- [ ] Name variants, pseudonyms, ORCID/ISNI/VIAF/Wikidata IDs
- [ ] Automatic matching with a review queue; merge, split, and "not the same person"

### Organization
- [ ] Colored tags
- [ ] Collections (shelves)
- [ ] Full-text and fuzzy search across metadata
- [ ] Filter by type, author, tag, date, format, language
- [ ] Sorting and saved searches (virtual libraries)

### Reading
- [ ] In-browser PDF viewer
- [ ] In-browser EPUB viewer
- [ ] Reading progress (percentage, page, position)
- [ ] Color-coded highlights and notes
- [ ] Annotation export (Markdown, JSON)

### Research
- [ ] DOI lookup via Crossref
- [ ] arXiv preprint lookup
- [ ] BibTeX, RIS, CSL-JSON export
- [ ] Link preprints to published versions

### Magazines
- [ ] Serial (journal/magazine) management
- [ ] Issues with volume/number
- [ ] Article-level records within issues

---

## Technology stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Frontend | React 18+, TypeScript, Vite | Single-page application |
| UI | Tailwind CSS + shadcn/ui | Components and styling |
| State | TanStack Query v5 + Zustand | Server / client state |
| Database | PostgreSQL 15+ (Supabase) | Persistence with Row-Level Security |
| Auth | Supabase Auth | Email, OAuth, magic links |
| File storage | Supabase Storage (S3-compatible) | Documents and covers |
| Backend logic | Supabase Edge Functions (Deno) | Metadata lookup, file processing, export |
| Job queue | PostgreSQL `jobs` table + `pg_cron` | Background processing (no Redis) |
| Search | PostgreSQL FTS + `pg_trgm` | Full-text and fuzzy search |
| Validation | Zod | Runtime schema validation |
| Readers | pdf.js, epub.js | Client-side rendering |

---

## Architecture overview

```
┌──────────────────────────────────────────────────────────┐
│                React + TypeScript SPA                    │
│      Library  ·  Reader  ·  Metadata editor              │
└───────────────┬──────────────┬──────────────┬────────────┘
                │              │              │
                ▼              ▼              ▼
        ┌──────────────┐ ┌────────────┐ ┌──────────────┐
        │ Supabase     │ │ PostgreSQL │ │ Supabase     │
        │ Auth (JWT)   │ │ + RLS      │ │ Storage      │
        └──────────────┘ └─────┬──────┘ └──────────────┘
                               │
                               ▼
                     ┌───────────────────┐
                     │ Edge Functions    │
                     │ • metadata-lookup │
                     │ • upload          │
                     │ • job-worker      │
                     │ • export          │
                     └─────────┬─────────┘
                               │
     ┌──────────────┬──────────┼───────────┬──────────────┐
     ▼              ▼          ▼           ▼              ▼
 Open Library   Crossref    arXiv    Semantic Scholar  Google Books
   (ISBN)        (DOI)    (preprint)   (papers)        (ISBN fallback)
```

External metadata providers are **only** called from Edge Functions — never from the browser.

### Data model

Textus uses a three-level hierarchy:

1. **Works** — intellectual content (a novel, a research paper, a journal)
2. **Records** — specific manifestations (2nd edition, published version, Vol. 5 Issue 3)
3. **Assets** — immutable file bytes (a PDF, an EPUB, a cover image)

```
┌─────────┐ 1:N ┌──────────┐ M:N ┌─────────┐
│  Work   │────>│  Record  │────>│  Asset  │
│ "Dune"  │     │ 1st ed.  │     │ PDF     │
│         │     │ 1965     │     │ EPUB    │
│         │     │          │     │ Cover   │
└─────────┘     └────┬─────┘     └─────────┘
                     │ 1:N
                     ▼
               ┌────────────┐
               │ Identifier │
               │ ISBN / DOI │
               │ ISSN/arXiv │
               └────────────┘
```

This allows one book in several formats, linking preprints to published versions, magazine issues as records under a serial work, chapters inside edited volumes, and proper metadata provenance.

People and organizations are **contributors** linked to records through **credits** (role + position + the name as printed). See [ARCHITECTURE_AND_REQUIREMENTS.md § 6.3](ARCHITECTURE_AND_REQUIREMENTS.md#63-contributors-authors-editors-and-other-roles) for how this improves on Calibre's model.

The database has 18 tables: `works`, `records`, `identifiers`, `contributors`, `contributor_names`, `contributor_identifiers`, `contributor_distinctions`, `record_contributors`, `assets`, `record_assets`, `tags`, `record_tags`, `collections`, `collection_records`, `reading_states`, `annotations`, `metadata_cache`, and `jobs`. See [ARCHITECTURE_AND_REQUIREMENTS.md § Database schema](ARCHITECTURE_AND_REQUIREMENTS.md#7-database-schema).

### Supported identifiers

| Scheme | Validation | Example |
|--------|------------|---------|
| `isbn` | ISBN-10/13 check digit, stored as ISBN-13 | `9780134685991` |
| `doi` | Pattern match, stored lowercase | `10.1038/nature12373` |
| `issn` | Check digit (may be `X`) | `0028-0836` |
| `arxiv` | `YYMM.NNNN(N)` with optional version | `2301.12345v2` |
| `pmid` | Numeric | `12345678` |

---

## Getting started

### Prerequisites

- Node.js 20+
- Docker (for the local Supabase stack)
- Git

### Local development

For development, use the Supabase CLI's local stack — it runs Postgres, Auth, Storage, and Edge Functions in Docker and applies migrations automatically.

```bash
git clone https://github.com/<your-org>/textus.git
cd textus
npm install

# Start local Supabase (prints the API URL and anon key)
npx supabase start

# Configure the frontend
cp .env.example .env.local
# set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from the output above

# Serve Edge Functions locally
npx supabase functions serve

# Start the app
npm run dev
```

Open `http://localhost:5173`.

### Scripts

```bash
npm run dev          # Vite dev server
npm run build        # Production build
npm run test         # Vitest
npm run test:watch   # Vitest in watch mode
npm run lint         # ESLint
npm run type-check   # tsc --noEmit
npm run gen:types    # Regenerate DB types (supabase gen types typescript)
```

### Database migrations

Migrations live in `supabase/migrations/`. Never edit an applied migration — create a new one.

```bash
npx supabase migration new <name>   # create
npx supabase db reset               # rebuild local DB from migrations (DESTRUCTIVE, local only)
```

---

## Self-hosted deployment

### 1. Supabase

Follow the official [self-hosting with Docker guide](https://supabase.com/docs/guides/self-hosting/docker). In short:

```bash
git clone --depth 1 https://github.com/supabase/supabase
mkdir supabase-project
cp -rf supabase/docker/. supabase-project
cd supabase-project && cp .env.example .env
# Edit .env — replace EVERY default secret:
#   POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY,
#   DASHBOARD_PASSWORD, SITE_URL, API_EXTERNAL_URL
docker compose pull && docker compose up -d
```

Storage caps every upload at 50 MB by default, below the 500 MB `documents`/`staging` bucket limit. Raise it with an override file layered through `COMPOSE_FILE`:

```bash
printf 'services:\n  storage:\n    environment:\n      FILE_SIZE_LIMIT: 524288000\n' > docker-compose.textus.yml
sh run.sh config add textus && docker compose up -d storage
```

### 2. Migrations

```bash
# Supavisor listens on 5432; the user is postgres.<POOLER_TENANT_ID>. Drop sslmode=disable once TLS is in front.
npx supabase db push --db-url "postgresql://postgres.<tenant-id>:<password>@<host>:5432/postgres?sslmode=disable"
```

### 3. Edge Functions

Self-hosted Supabase serves functions from its `volumes/functions/` directory:

```bash
cp -r supabase/functions/* /path/to/supabase-project/volumes/functions/
cd /path/to/supabase-project && docker compose restart functions
```

Set function secrets (service role key, optional provider API keys) in the Supabase project's `.env`.

### 4. Frontend

Vite inlines `VITE_*` variables at **build time**, so pass them as build arguments, not runtime environment:

```bash
docker build \
  --build-arg VITE_SUPABASE_URL=https://supabase.example.com \
  --build-arg VITE_SUPABASE_ANON_KEY=<anon-key> \
  -t textus .
docker run -p 3000:80 textus
```

The image is a static build served by any web server (e.g. nginx).

### Environment variables

| Variable | Where | Required |
|----------|-------|----------|
| `VITE_SUPABASE_URL` | Frontend (build time) | Yes |
| `VITE_SUPABASE_ANON_KEY` | Frontend (build time) | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions only | Yes |
| `CROSSREF_MAILTO` | Edge Functions — Crossref polite pool | Recommended |
| `SEMANTIC_SCHOLAR_API_KEY` | Edge Functions | Optional |
| `GOOGLE_BOOKS_API_KEY` | Edge Functions | Optional |

**Never** expose `SUPABASE_SERVICE_ROLE_KEY` to the frontend.

---

## Security

- Row-Level Security is enabled on every table; users can only read and modify their own library.
- All storage buckets are private. Files are served through signed URLs that expire after 5 minutes.
- Uploaded files are verified server-side (size, detected MIME type, SHA-256). Client-reported MIME types are ignored.
- Assets can only be created by the server after verification, and are immutable afterwards.
- Provider API keys live only in Edge Functions. Outbound fetches have timeouts, response size limits, and host allowlists.

---

## Backup and recovery

Back up three things: the **PostgreSQL database**, **Storage objects**, and **configuration** (`.env`, compose files).

```bash
# Database
pg_dump "postgresql://postgres:<password>@<host>:5432/postgres" > backup_$(date +%Y%m%d).sql

# Storage (S3-compatible endpoint)
rclone sync <remote>:documents ./backup/documents
rclone sync <remote>:covers    ./backup/covers

# Restore
psql "postgresql://postgres:<password>@<host>:5432/postgres" < backup_20260101.sql
rclone sync ./backup/documents <remote>:documents
```

Database and storage must be backed up together — an asset row without its file (or vice versa) is an inconsistency.

---

## Contributing

1. Fork the repository and create a branch (`git checkout -b feat/my-feature`)
2. Use [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`)
3. Keep TypeScript strict, add tests for new behavior, update docs when contracts change
4. Make sure `npm run lint`, `npm run type-check`, and `npm run test` pass
5. Open a pull request

Read [CLAUDE.md](CLAUDE.md) and [ARCHITECTURE_AND_REQUIREMENTS.md](ARCHITECTURE_AND_REQUIREMENTS.md) before touching the schema, RLS, or Edge Function contracts.

---

## License

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).

## Acknowledgments

- [Calibre](https://calibre-ebook.com/) — inspiration for ebook management
- [Supabase](https://supabase.com/) — backend platform
- [Open Library](https://openlibrary.org/), [Crossref](https://www.crossref.org/), [Semantic Scholar](https://www.semanticscholar.org/), [arXiv](https://arxiv.org/) — metadata sources
