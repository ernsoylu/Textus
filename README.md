# Textus

> Self-hosted library manager for books, research papers, and magazines.

[![CI](https://github.com/ernsoylu/Textus/actions/workflows/ci.yml/badge.svg)](https://github.com/ernsoylu/Textus/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Self--hosted-green)](https://supabase.com/docs/guides/self-hosting)

> **Status:** pre-alpha, in-house development. Milestones M1–M5 are implemented except OAuth, which is deferred until release planning. What is left (polish, hardening, unbuilt design states) is tracked in [docs/ROADMAP.md](docs/ROADMAP.md).
> The full specification lives in [ARCHITECTURE_AND_REQUIREMENTS.md](ARCHITECTURE_AND_REQUIREMENTS.md).

## What is Textus?

Textus is a web-based personal library manager for **books**, **scientific papers**, and **magazines** with proper bibliographic modeling. Unlike generic file managers or simple ebook readers, Textus understands the difference between a work, its editions, and the files you own.

### Key differentiators

- **Proper domain model** — separates intellectual works from specific editions and from file assets
- **Multi-format** — one book can have PDF, EPUB, MOBI, AZW3, CBZ and DjVu files, all readable in the browser
- **Research-ready** — DOI, arXiv, and PMID lookup with citation export
- **Magazine-aware** — serial/issue relationships with completeness tracking
- **Self-hosted** — your data stays on your infrastructure

---

## Features

### Document management
- [x] Upload PDF, EPUB, MOBI, AZW3, CBZ, DjVu with server-side format detection
- [x] Metadata lookup via ISBN, DOI, arXiv, PMID, ISSN and ISO/IEC/ASTM/ASME/BS references
- [x] Manual metadata entry with validation
- [x] Multiple file formats per record
- [x] Cover extraction from files or retrieval from providers
- [x] Duplicate detection (by identifier or file checksum)

### Authors and contributors
- [x] Contributors are identities, not name strings — two people named "John Smith" stay separate, and "J. Smith" / "Smith, John A." can be linked to one person
- [x] Roles per credit: author, editor, compiler, translator, illustrator, series editor, introduction
- [x] Edited volumes: bylines and citations fall back to editors when there are no authors; chapters link to their volume
- [x] Name variants, pseudonyms, ORCID/ISNI/VIAF/Wikidata IDs
- [x] Automatic matching with a review queue; merge, split, and "not the same person"

### Organization
- [x] Automatically colored tags on records, collections and notes, with a detail page per tag
- [x] Collections (shelves)
- [x] Partial, accent-insensitive Unicode metadata search, fuzzy contributor matching and full-text search of extracted PDF/EPUB text
- [x] Filter by type, tag, collection, reading status, format and language
- [x] Sorting and saved searches (virtual libraries)
- [x] Optional personal book ratings from 0.5 to 5 stars, in half-star steps
- [x] Cover controls for Read, View details and ratings, accessible on hover, focus and touch

### Reading
- [x] PDF: continuous scroll, fit modes, zoom, two-page spreads, contents and text search
- [x] EPUB/MOBI/AZW3: paginated or scrolling layout, contents, search, text size, line spacing and themes
- [x] CBZ comics and DjVu scans, with OCR text selection for DjVu files that contain text
- [x] Fullscreen reading (F) and keyboard navigation
- [x] Reading progress (percentage, page, position)
- [x] Select text and right-click to highlight or comment; comments open from in-text markers
- [x] Notes grouped by book, with search, tag/color/comment filters and links to their reader positions
- [x] Annotation export (Markdown, JSON)

### Research
- [x] DOI lookup via Crossref
- [x] arXiv preprint lookup
- [x] BibTeX, RIS, CSL-JSON export
- [x] Link preprints to published versions

### Magazines
- [x] Serial (journal/magazine) management
- [x] Issues with volume/number
- [x] Article-level records within issues

---

## Technology stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Frontend | React 18+, TypeScript, Vite | Single-page application |
| UI | Tailwind CSS + shadcn/ui | Components and styling |
| State | TanStack Query v5 + Zustand | Server / client state |
| Database | PostgreSQL 15+ (Supabase) | Persistence with Row-Level Security |
| Auth | Supabase Auth | Email/password and magic links; OAuth deferred |
| File storage | Supabase Storage (S3-compatible) | Documents and covers |
| Backend logic | Supabase Edge Functions (Deno) | Metadata lookup, file processing, export |
| Job queue | PostgreSQL `jobs` table + `pg_cron` | Background processing (no Redis) |
| Search | PostgreSQL FTS + `pg_trgm` | Full-text and fuzzy search |
| Validation | Zod | Runtime schema validation |
| Readers | pdf.js, foliate-js, DjVu.js | Client-side rendering; foliate-js is pinned to a GitHub tarball, DjVu.js is vendored in `src/vendor/djvu` (GPL-2.0-or-later) |

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
                     │ • opds            │
                     └─────────┬─────────┘
                               │
     ┌──────────────┬──────────┼───────────┬──────────────┐
     ▼              ▼          ▼           ▼              ▼
 Open Library   Crossref    arXiv    Semantic Scholar  Google Books
   (ISBN)        (DOI)    (preprint)   (papers)        (ISBN fallback)
```

External metadata providers are **only** called from Edge Functions — never from the browser.
ISBN lookups use Internet Archive as a third fallback after Open Library and Google Books; no Archive API key is needed.

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

The database has 22 tables: `works`, `records`, `identifiers`, `contributors`, `contributor_names`, `contributor_identifiers`, `contributor_distinctions`, `record_contributors`, `assets`, `record_assets`, `tags`, `record_tags`, `collections`, `collection_records`, `reading_states`, `annotations`, `metadata_cache`, `jobs`, `saved_searches`, `asset_texts`, `collection_tags`, and `annotation_tags`. See [ARCHITECTURE_AND_REQUIREMENTS.md § Database schema](ARCHITECTURE_AND_REQUIREMENTS.md#7-database-schema).

### Supported identifiers

| Scheme | Validation | Example |
|--------|------------|---------|
| `isbn` | ISBN-10/13 check digit, stored as ISBN-13 | `9780134685991` |
| `doi` | Pattern match, stored lowercase | `10.1038/nature12373` |
| `issn` | Check digit (may be `X`) | `0028-0836` |
| `arxiv` | `YYMM.NNNN(N)` with optional version | `2301.12345v2` |
| `pmid` | Numeric | `12345678` |
| `iso`, `iec`, `astm`, `asme`, `bs` | Authority reference with edition year; whitespace and trailing language markers normalized | `ISO 9001:2015`, `ASTM D638-14` |

---

## Getting started

### Prerequisites

- Node.js 22.13+ (CI and Docker builds use Node.js 24)
- Docker (for the local Supabase stack)
- Git

### Local development

For development, use the Supabase CLI's local stack — it runs Postgres, Auth, Storage, and Edge Functions in Docker and applies migrations automatically.

```bash
git clone https://github.com/ernsoylu/Textus.git
cd Textus
npm ci --ignore-scripts

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
npm run test:e2e     # Playwright; install Chromium once with npx playwright install chromium
npm run lint         # ESLint
npm run type-check   # tsc --noEmit
npm run gen:types    # Regenerate DB types (supabase gen types typescript)
deno test --config supabase/functions/deno.jsonc --allow-env supabase/functions/
# HTTP integration needs the local stack and its credentials:
deno test --allow-env --allow-net supabase/tests/functions/integration.test.ts
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

Storage caps every upload at 50 MB by default, below the 500 MB `documents`/`staging` bucket limit. Its file backend also re-hashes the whole file for an MD5 ETag on every request, including each pdf.js range request (about 0.6 s per request for a 300 MB PDF); documents are content-addressed and immutable, so the `mtime` ETag is safe. Set both with an override file layered through `COMPOSE_FILE`:

```bash
printf 'services:\n  storage:\n    environment:\n      FILE_SIZE_LIMIT: 524288000\n      STORAGE_FILE_ETAG_ALGORITHM: mtime\n' > docker-compose.textus.yml
sh run.sh config add textus && docker compose up -d storage
```

### 2. Migrations

```bash
# Supavisor listens on 5432; the user is postgres.<POOLER_TENANT_ID>. Drop sslmode=disable once TLS is in front.
npx supabase db push --db-url "postgresql://postgres.<tenant-id>:<password>@<host>:5432/postgres?sslmode=disable"
```

### 3. Edge Functions

Self-hosted Supabase serves functions from its `volumes/functions/` directory — one subdirectory per function, each with its own `index.ts`, routed by the project's `main/index.ts` (from `setup.sh`, not part of this repo):

```bash
cp -r supabase/functions/* /path/to/supabase-project/volumes/functions/
cd /path/to/supabase-project && docker compose restart functions
```

Functions use [`@supabase/server`](https://github.com/supabase/server)'s `withSupabase()` for auth, CORS, and client creation — `auth: 'user'` requires a caller JWT and gives the handler `ctx.supabase` (RLS-scoped, for ownership checks) and `ctx.supabaseAdmin` (service role, for privileged writes). It needs the new-format API keys and JWT signing keys (`setup.sh` already generates both — see `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` / `SUPABASE_JWKS` in the `functions` service's environment in `docker-compose.yml`); legacy `anon`/`service_role` JWT-style keys are not accepted by it.

Provider configuration (`CROSSREF_MAILTO`, `SEMANTIC_SCHOLAR_API_KEY`, `GOOGLE_BOOKS_API_KEY`, `FIRECRAWL_API_KEY`) goes in the Supabase project's `.env` and the functions service environment.

### 4. Frontend

Vite inlines `VITE_*` variables at **build time**, so they are build arguments, not runtime environment. The provided image serves the SPA with nginx and **proxies `/auth`, `/rest`, `/storage` and `/functions` to the Supabase gateway over Docker's internal network**, so the browser only talks to one origin and API calls skip the public gateway. Run it on the same host as Supabase and join Supabase's compose network:

```bash
echo 'VITE_SUPABASE_ANON_KEY=<publishable key>' > .env      # VITE_SUPABASE_URL is not needed; add VITE_TURNSTILE_SITE_KEY for CAPTCHA
docker compose up -d --build                                  # serves on :8080 (TEXTUS_PORT to change)
```

`docker-compose.yml` attaches the container to the external `supabase_default` network; nginx reaches the gateway at `api-gw:8000` (`deploy/nginx.conf`). The SPA calls its own origin, so the CSP's `connect-src 'self'` holds and the proxy forces document downloads to attach. If Supabase runs elsewhere, build with `VITE_SUPABASE_URL` and add that origin to `connect-src`/`img-src` in `deploy/security-headers.conf`.

Point Supabase Auth at the app so magic links and recovery links land on it: set `SITE_URL` (and `ADDITIONAL_REDIRECT_URLS`) to the app's URL in the Supabase `.env`, then `docker compose up -d auth`. Auth emails also need a working SMTP server (`SMTP_*` in the same `.env`); without one, generate links with the admin API (`/auth/v1/admin/generate_link`).

Textus is invite-only and its sign-in is CAPTCHA-protected. Create a Cloudflare Turnstile widget for the app's hostname, build the SPA with `VITE_TURNSTILE_SITE_KEY`, put the secret in the Supabase `.env` as `TURNSTILE_SECRET_KEY`, then extend the `auth` service (app102 keeps this in `docker-compose.textus.yml`) and run `docker compose up -d --no-deps auth`:

```yaml
  auth:
    environment:
      GOTRUE_DISABLE_SIGNUP: "true"          # the owner creates accounts with the Auth admin API
      GOTRUE_SECURITY_CAPTCHA_ENABLED: "true"
      GOTRUE_SECURITY_CAPTCHA_PROVIDER: turnstile
      GOTRUE_SECURITY_CAPTCHA_SECRET: ${TURNSTILE_SECRET_KEY:?set TURNSTILE_SECRET_KEY in .env}
```

Deploy the frontend with the widget before enabling the CAPTCHA, or sign-in stops working. OPDS readers authenticate with an agent token as the Basic-auth password, so the CAPTCHA does not affect them.

The `opds` function authenticates e-readers itself (HTTP Basic, §8.5), so it must be reachable without a JWT: `verify_jwt = false` locally (already in `supabase/config.toml`) and `--no-verify-jwt` on hosted projects; the self-hosted `main` router does not verify JWTs unless `VERIFY_JWT=true`.

### Environment variables

| Variable | Where | Required |
|----------|-------|----------|
| `VITE_SUPABASE_URL` | Frontend (build time) | Optional; defaults to the app origin and nginx proxy |
| `VITE_TURNSTILE_SITE_KEY` | Frontend (build time) | Production; must match Supabase Auth's CAPTCHA secret |
| `VITE_SUPABASE_ANON_KEY` | Frontend (build time) | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions only | Yes |
| `CROSSREF_MAILTO` | Edge Functions — Crossref polite pool | Recommended |
| `SEMANTIC_SCHOLAR_API_KEY` | Edge Functions | Optional |
| `GOOGLE_BOOKS_API_KEY` | Edge Functions | Optional |
| `FIRECRAWL_API_KEY` | Edge Functions only | Required for ISO/IEC/ASTM/ASME/BS reference lookup |

On self-hosted Supabase, pass provider keys through the `functions` service's `docker-compose.yml` environment and recreate that service after changing `.env`. The SPA never receives these keys. Semantic Scholar may rate-limit unauthenticated PMID requests.

**Never** expose `SUPABASE_SERVICE_ROLE_KEY` to the frontend.

---

## Security

- Row-Level Security is enabled on every table; users can only read and modify their own library.
- All storage buckets are private. Files are served through signed URLs that expire after 5 minutes.
- Uploaded files are verified server-side (size, detected MIME type, SHA-256). Client-reported MIME types are ignored.
- Assets can only be created by the server after verification, and are immutable afterwards.
- Provider API keys live only in Edge Functions. Outbound fetches have timeouts, response size limits, and host allowlists.
- Books never run their own scripts. The Content-Security-Policy in `deploy/security-headers.conf` blocks them in the reader's book iframes, and every book page also carries a `script-src 'none'` policy, which covers servers that send no CSP header.

---

## Backup and recovery

Run `bash deploy/backup.sh` on app102. It briefly pauses API writers, snapshots the committed database and filesystem Storage together, captures private configuration and the deployed frontend image ID, then resumes services even after failure. Snapshots live under `~/.local/share/textus-backups/` with restricted permissions; keep an encrypted off-host copy. Never commit or publish their contents.

Run `bash deploy/restore-drill.sh <snapshot>` on app102 after each backup. It verifies `SHA256SUMS`, starts the frozen `postgres.tar` data directory (including the pgsodium root key Vault needs) in a network-less container with pg_cron jobs disabled, then fails unless every public table has RLS, every bucket is private, and policies, table grants and function privileges match production exactly. It deletes the restored `agent_tokens` and verifies every asset against its Storage object version, byte size and SHA-256. For real recovery, restore `postgres.tar` into the `db` volumes of the same `supabase/postgres` image and `storage.tar` into Storage before starting services, delete restored `agent_tokens` before enabling MCP, discard abandoned staging uploads, and rebuild derived passage/vector indexes. `database.dump` is for inspecting or extracting individual tables only: replaying it into a fresh Supabase image collides with the image's own `auth`/`storage` schemas and silently drops users and foreign keys. `bash deploy/smoke-private-files.sh` proves that anonymous object/table reads through the public API fail.

Deploy migrations, functions and frontend with `AI_ENABLED`, `MCP_ENABLED` and `MCP_WRITES_ENABLED` false. Run HTTPS, private-file and login smoke tests before enabling MCP; enable AI only after monster's network/local-model restrictions pass. If a release fails, disable these flags first and restore the saved functions/frontend image. Keep additive database migrations; use the verified full snapshot only for disaster recovery.

Before setting `AI_ENABLED=true`, run `ssh -t monster 'sudo sh -s' < deploy/ollama-hardening.sh`. It disables Ollama cloud inference and bounds concurrency/queueing in a separate systemd drop-in; Ollama stays reachable from the LAN for other uses. Textus only selects models in `OLLAMA_ALLOWED_MODELS`, but other LAN clients can manage models and share the GPU outside Textus's lease, so busy-GPU AI jobs defer rather than fail.

**Background worker limits.** pdf.js allocates a buffer the size of the whole PDF, and the Edge runtime counts it against the worker's memory limit, so the default 150 MB / 60 s cannot index large PDFs. On app102, `volumes/functions/main/index.ts` (Supabase's Edge router, not in this repo; re-apply after Supabase updates) gives `job-worker` alone more room:

```ts
const isJobWorker = service_name === 'job-worker'
const memoryLimitMb = isJobWorker ? 1024 : 150
const workerTimeoutMs = (isJobWorker ? 115 : 60) * 1000
```

Then set `JOB_WORKER_MEMORY_MB: "1024"` and `JOB_WORKER_BUDGET_MS: "100000"` in the `functions` environment. They must match the router: without them the worker keeps 60 s batches and reports PDFs over 90 MB as not indexable. With them set but the router unchanged, every long run is killed. Give the `functions` service `ulimits: { nofile: 65536 }` as headroom: the container starts with 1024 descriptors and about half are in use. Run the worker every 30 seconds with `SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='job-worker'), schedule := '30 seconds');`.

Rollback: `docker tag textus-web:backup-<snapshot> textus-web:latest && docker compose up -d --no-build textus`, and extract `volumes/functions` from the snapshot's `configuration.tar.gz` before restarting the `functions` service.

Daily cleanup retains completed jobs for 30 days and removes rate counters after two idle days. Agent action replay results remain while their token can authenticate, then become eligible 30 days after token expiry or deletion. Library text/notes remain owner data until deletion. Operational logs contain no token values, tool arguments, questions or signed URL query strings; frontend Docker logs rotate at 10 MB × 3.

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

### Standards metadata lookup

Choose ISO, IEC, ASTM, ASME or BS under **Look up metadata** and enter the full reference with its edition year, for example `ISO/PAS20065:2016(E)`, `IEC 60335-1:2020`, `ASTM D638-14`, `ASME B31.3-2024` or `BS EN ISO 9001:2015`. Review the catalogue source and selected fields, then apply. Missing matches and inaccessible catalogues return an error rather than metadata from another edition.

Standards lookup uses Firecrawl search and structured extraction of official catalogue pages. Set `FIRECRAWL_API_KEY` in the server's Supabase `.env` and pass it to the `functions` service through a compose override:

```yaml
services:
  functions:
    environment:
      FIRECRAWL_API_KEY: ${FIRECRAWL_API_KEY:-}
```

Recreate the functions service after configuring the key. Keep this key out of `VITE_*` variables and frontend environment files.
