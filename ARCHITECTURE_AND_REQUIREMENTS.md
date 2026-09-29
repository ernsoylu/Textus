# Textus — Architecture and Requirements

This is the authoritative specification for Textus. [README.md](README.md) is the human overview; [CLAUDE.md](CLAUDE.md) is the working guide for AI-assisted development. When they disagree, this document wins — fix the others.

**Contents**

1. [Purpose and scope](#1-purpose-and-scope)
2. [Functional requirements](#2-functional-requirements)
3. [Non-functional requirements](#3-non-functional-requirements)
4. [Technology stack and constraints](#4-technology-stack-and-constraints)
5. [System architecture](#5-system-architecture)
6. [Domain model and identifiers](#6-domain-model-and-identifiers)
7. [Database schema](#7-database-schema)
8. [Edge Functions](#8-edge-functions)
9. [Key flows](#9-key-flows)
10. [External metadata providers](#10-external-metadata-providers)
11. [TypeScript types](#11-typescript-types)
12. [Project structure](#12-project-structure)
13. [Milestones](#13-milestones)
14. [Deviations from the original definition](#14-deviations-from-the-original-definition)
15. [Open questions and risks](#15-open-questions-and-risks)

---

## 1. Purpose and scope

Textus is a self-hosted, web-based library manager for books, research papers, and magazines. It models bibliographic data properly — separating works, their manifestations, and file assets — and offers in-browser reading, annotation, metadata lookup, and citation export.

**Target users:** researchers, students, and readers managing mixed collections on their own infrastructure.

**In scope:** single-user libraries (each account owns an isolated library), multiple accounts per instance, PDF/EPUB reading in the browser, metadata from public providers.

**Out of scope (for now):** public/shared collections, multi-user shared libraries, storage backends other than Supabase Storage (no Google Drive, NAS adapters), native mobile apps, DRM-protected files, format conversion.

---

## 2. Functional requirements

IDs are stable; reference them in issues and commits. Milestones are defined in [§13](#13-milestones).

### Accounts (M1)
| ID | Requirement |
|----|-------------|
| FR-AUTH-1 | Users sign up and sign in with email/password, magic link, or OAuth (Supabase Auth). |
| FR-AUTH-2 | Every piece of user data is private to its owner, enforced by Row-Level Security. |

### Catalog (M1)
| ID | Requirement |
|----|-------------|
| FR-CAT-1 | Create, read, update, delete works, records, identifiers, and contributors. |
| FR-CAT-2 | A work has one or more records; a record belongs to exactly one work. |
| FR-CAT-3 | Records carry ordered contributor credits with roles — see [Contributors](#contributors). |
| FR-CAT-4 | Identifiers are validated and normalized on entry (see [§6.2](#62-identifier-rules)); invalid identifiers are rejected with a reason. |
| FR-CAT-5 | Adding a record whose identifier already exists in the user's library warns about the duplicate. |

### Contributors
Design in [§6.3](#63-contributors-authors-editors-and-other-roles).

| ID | Requirement | Milestone |
|----|-------------|-----------|
| FR-CONTRIB-1 | A contributor is an identity (person or organization), not a name string. Two contributors may share a name; one contributor may have many names. | M1 |
| FR-CONTRIB-2 | Person names are structured (family, given, particle, suffix); organizations have a single name. Pasted text like `Tolkien, J. R. R. & Christopher Tolkien` is parsed into a previewed, editable list. | M1 |
| FR-CONTRIB-3 | Each record has ordered credits per role: author, editor, translator, illustrator, compiler, series editor, introduction, contributor. The name as printed on the record is preserved. | M1 |
| FR-CONTRIB-4 | When a record has no authors, bylines, sorting, and citations fall back to editors, then compilers, then translators. | M1 |
| FR-CONTRIB-5 | Name variants, pseudonyms, transliterations, and external IDs (ORCID, ISNI, VIAF, Wikidata, Open Library, Semantic Scholar) are stored per contributor. | M2 |
| FR-CONTRIB-6 | Imported names are matched to existing contributors using external IDs and evidence (name compatibility, shared works, co-authors, affiliation). Uncertain matches create a provisional contributor for review instead of guessing. | M2 |
| FR-CONTRIB-7 | Merge two contributors (refused when they have conflicting external IDs unless forced); split by moving selected credits to another contributor; remember "not the same person" decisions. | M3 |
| FR-CONTRIB-8 | Duplicate finder lists likely-same contributors for review. | M3 |
| FR-CONTRIB-9 | Contributor page: all credits grouped by role, names, IDs with external links. | M3 |
| FR-CONTRIB-10 | Chapters and articles can be records contained in another record (edited volume, issue); container editors appear in citations without being copied. | M5 |

### Files (M1)
| ID | Requirement |
|----|-------------|
| FR-FILE-1 | Upload PDF, EPUB, MOBI, AZW3, CBZ files and attach them to a record. |
| FR-FILE-2 | The server verifies size, detects the real MIME type from file bytes, and computes SHA-256. |
| FR-FILE-3 | Uploading bytes already in the user's library reuses the existing asset (deduplication by checksum). |
| FR-FILE-4 | A record can have several assets with roles: primary, supplement, cover, converted, thumbnail. |
| FR-FILE-5 | Uploads are idempotent: retrying an upload with the same upload ID does not create duplicates. |
| FR-FILE-6 | Asset processing state (pending → processing → ready / failed) is visible in the UI. |

### Search and organization (M1, M3)
| ID | Requirement | Milestone |
|----|-------------|-----------|
| FR-SRCH-1 | Full-text search over title, subtitle, abstract, and contributor names, with fuzzy matching on titles and names. | M1 |
| FR-ORG-1 | Colored tags; many tags per record. | M3 |
| FR-ORG-2 | Collections (shelves) with manual ordering. | M3 |
| FR-ORG-3 | Filter by work type, tag, collection, reading status, file format, language; sort by title, author, date added, date published, recently read. | M3 |
| FR-ORG-4 | Bulk tag / move / delete. | M3 |
| FR-ORG-5 | Saved searches (virtual libraries). | M3 |

### Metadata (M2)
| ID | Requirement |
|----|-------------|
| FR-META-1 | Look up metadata by ISBN, DOI, arXiv ID, PMID, ISSN. |
| FR-META-2 | Show fetched metadata as a preview; the user confirms before it is applied. |
| FR-META-3 | Fields edited manually by the user are locked and never overwritten by a lookup. |
| FR-META-4 | Every applied lookup records its source provider and fetch time. |
| FR-META-5 | Provider responses are cached; repeated lookups are served from cache. |
| FR-META-6 | Lookup failures are reported precisely: not found, invalid identifier, rate limited, provider error. |

Metadata precedence when merging: (1) user-locked manual values, (2) reviewed exact identifier matches, (3) metadata extracted from the file, (4) unreviewed provider suggestions.

### Reading (M1, M4)
| ID | Requirement | Milestone |
|----|-------------|-----------|
| FR-READ-1 | In-browser PDF viewer with page navigation and zoom. | M1 |
| FR-READ-2 | In-browser EPUB viewer. | M4 |
| FR-READ-3 | Reading progress (percentage, page, position) and status (unread, reading, finished, abandoned) sync across devices. | M4 |
| FR-READ-4 | Highlights and notes with colors, anchored to a specific asset. | M4 |
| FR-READ-5 | Export annotations as Markdown and JSON. | M4 |
| FR-READ-6 | MOBI/AZW3/CBZ assets are downloadable; in-browser reading for them is not required. | M4 |

### Research and serials (M5)
| ID | Requirement |
|----|-------------|
| FR-RES-1 | Export records as BibTeX, RIS, and CSL-JSON. |
| FR-RES-2 | Link a preprint record and its published-version record under the same work. |
| FR-RES-3 | Bulk import from CSV or a list of DOIs. |
| FR-SER-1 | Model serials (journals/magazines) as works of type `serial` with issues as records. |
| FR-SER-2 | Show volume/issue completeness per serial. The run a collector expects is stored as text per volume in `works.metadata.expected_issues` (`{"2024": "1-6, 8"}`); without one, issues are assumed to run 1..max. |
| FR-SER-3 | OPDS catalog feed. |

---

## 3. Non-functional requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NFR-SEC-1 | Security | RLS enabled on every table, with an explicit decision (policy or deliberate absence) for each operation. |
| NFR-SEC-2 | Security | All buckets private; file access through signed URLs valid for 5 minutes. |
| NFR-SEC-3 | Security | Service role key and provider API keys exist only in Edge Functions. |
| NFR-SEC-4 | Security | Client-reported MIME types are never trusted. |
| NFR-SEC-5 | Security | Outbound provider requests use a host allowlist, timeouts (10 s), and response size limits (5 MB). |
| NFR-PERF-1 | Performance | Library list and search: p95 < 300 ms server time at 10,000 records per user. |
| NFR-PERF-2 | Performance | Every RLS policy uses indexed columns and `(select auth.uid())` so it is evaluated once per query. |
| NFR-REL-1 | Reliability | Background jobs are retried up to `max_attempts` with a lease so crashed workers do not lose work. |
| NFR-REL-2 | Reliability | A failed step never leaves an asset row pointing to a missing file. |
| NFR-A11Y-1 | Accessibility | Library and metadata UI meet WCAG 2.1 AA; the reader is keyboard-navigable. |
| NFR-OPS-1 | Operations | Deployable with Docker on a single host; backup = `pg_dump` + storage sync. |
| NFR-MAINT-1 | Maintainability | TypeScript strict mode, no `any`; Zod validation at every trust boundary. |

---

## 4. Technology stack and constraints

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React | 18+ |
| Language | TypeScript | 5.0+, strict |
| Build | Vite | 5+ |
| Styling | Tailwind CSS | 3.4+ |
| Components | shadcn/ui | latest |
| Server state | TanStack Query | v5 |
| Client state | Zustand | 4+ |
| Database | PostgreSQL (Supabase) | 15+ |
| Auth | Supabase Auth | self-hosted |
| Storage | Supabase Storage | S3-compatible |
| Server logic | Supabase Edge Functions | Deno (Supabase runtime) |
| Scheduling | `pg_cron` + `pg_net` | Supabase-bundled |
| Validation | Zod | 3+ |
| Testing | Vitest + Testing Library | latest |
| Readers | pdf.js, epub.js | latest |

**Constraints (fixed decisions):**
- No other React framework (Next.js, Remix, …). The app is a Vite SPA.
- No separate backend service or language. Server logic is Edge Functions + SQL.
- No direct S3 SDK usage — go through the Supabase Storage API.
- No Redis, RabbitMQ, or external queue — the `jobs` table is the queue.
- No ORM — Supabase client, plus SQL functions where a query needs it.
- Database row types are generated (`supabase gen types typescript`), not hand-written.

---

## 5. System architecture

```
Browser (React SPA)
  │  supabase-js with the user's JWT (anon key)
  ├──────────────► PostgREST ──► PostgreSQL (RLS)      catalog reads/writes
  ├──────────────► Storage     (signed URLs only)       file reads
  └──────────────► Edge Functions                       lookup, upload, export
                        │  service role
                        ├──► PostgreSQL / Storage
                        └──► External providers (allowlisted hosts)

pg_cron (every minute) ──pg_net──► job-worker Edge Function ──► jobs table
```

**Responsibilities**

| Component | Does | Never does |
|-----------|------|-----------|
| SPA | Catalog CRUD via supabase-js under RLS; renders files from signed URLs; calls Edge Functions | Calls external providers; holds the service role key; creates assets |
| PostgreSQL | Stores everything; enforces ownership (RLS), uniqueness, asset immutability (trigger) | — |
| Edge Functions | Validate input with Zod; talk to providers; verify uploads; create assets; run jobs | Return placeholder data; trust client MIME types |
| Storage | Holds bytes in `documents`, `covers`, `staging` buckets | Serves anything publicly |

---

## 6. Domain model and identifiers

### 6.1 Works, records, assets

```
Work (intellectual content)        "Dune" · a paper · "Nature" (serial)
 └── Record (manifestation)        1965 1st edition · published version · Vol. 5 Issue 3
       ├── Identifier              ISBN / DOI / ISSN / arXiv / PMID
       ├── Credit → Contributor    author, editor, translator, … (ordered per role)
       ├── Asset (file bytes)      PDF · EPUB · cover image
       └── contained records       chapters of an edited volume · articles of an issue
```

- **Work** — the intellectual content. Types: `book`, `article`, `chapter`, `serial`, `thesis`, `report`, `standard`, `other`.
- **Record** — a specific manifestation. Types: `edition`, `article_version`, `chapter`, `issue`, `report`, `thesis`, `standard`, `other`. A record's `title` may differ from the work's (an article title inside an issue, an issue theme). A record may sit inside another record through `container_record_id` (a chapter in an edited volume, an article in an issue) — see [§6.3](#63-contributors-authors-editors-and-other-roles).
- **Asset** — immutable bytes with a SHA-256 checksum. Linked to records M:N through `record_assets` with a role. A changed file is a new asset, never an update.

The edit page uses work and record types independently. Article records expose journal, version, volume, issue and pages/article number; book editions expose publisher, edition, volume and pages; reports expose issuing institution, edition and pages; theses expose university, degree and pages; standards expose standards body, revision and pages. Hidden fields are preserved. The library Type filter includes every supported work type. Books have an optional owner rating of 1–5 stars, editable on the work and displayed on library cards.

Never conflate levels: a PDF is not a book. It is an asset linked to a record, which is an edition of a work.

**Mapping examples**

| Real thing | Work | Record(s) | Assets |
|-----------|------|-----------|--------|
| Dune, in PDF and EPUB | `book` "Dune" | `edition` 1965 | PDF (primary), EPUB (primary), JPEG (cover) |
| arXiv preprint later published | `article` | `article_version` preprint, `article_version` published | one PDF per version |
| Nature Vol. 5 Issue 3 | `serial` "Nature" | `issue` volume=5, issue_number=3 | PDF |
| Edited handbook with chapters | `book` + one `chapter` work per tracked chapter | `edition` (editors) + `chapter` records with `container_record_id` → edition | PDF on the edition |

### 6.2 Identifier rules

Standards use `iso`, `iec`, `astm`, `asme` or `bs` schemes. References require an edition year; normalization removes whitespace and a trailing language marker such as `(E)` and preserves parts, amendments and reapproval years. A request such as `ISO/PAS20065:2016(E)` matches `ISO/PAS 20065:2016`. Catalogue lookup never substitutes a different edition. Apply stores the reference in `identifiers`, native record fields such as revision in `records`, and status/source URL in `records.metadata`, while preserving manual locks. Applying work type Standard changes an unlocked record type to Standard.

Stored in the `identifiers` table — never in JSONB. `original_value` keeps what the user typed; `normalized_value` is used for matching and deduplication.

| Scheme | Accepted input | Validation | Normalized form |
|--------|---------------|------------|-----------------|
| `isbn` | ISBN-10 or ISBN-13, with or without hyphens/spaces, optional `ISBN` prefix | ISBN-10 mod-11 (check char may be `X`) or ISBN-13 mod-10 check digit | ISBN-13, digits only (ISBN-10 → `978` prefix + recomputed check digit) |
| `doi` | Bare DOI, `doi:` prefix, or `https://doi.org/` / `https://dx.doi.org/` URL | `^10\.\d{4,9}/\S+$` after prefix stripping | Lowercase (DOIs are case-insensitive) |
| `issn` | `12345678` or `1234-5678` | Mod-11 check digit (may be `X`) | `1234-567X` uppercase with hyphen |
| `arxiv` | `2301.12345`, `2301.12345v2`, `arXiv:` prefix, `arxiv.org/abs/…` URL | `^\d{4}\.\d{4,5}(v\d+)?$` | ID without version; version stored in `records.metadata.arxiv_version` |
| `pmid` | Digits, optional `PMID:` prefix | `^\d{1,9}$` | Digits without leading zeros |

Validation lives in one shared module used by both the SPA and Edge Functions (see [§12](#12-project-structure)). It must have unit tests covering valid/invalid check digits and each accepted input form.

**Contributor identifiers** (stored in `contributor_identifiers`, see §6.3):

| Scheme | Accepted input | Validation | Normalized form |
|--------|---------------|------------|-----------------|
| `orcid` | `0000-0002-1825-0097`, `https://orcid.org/…` | ISO 7064 mod 11-2 check digit (may be `X`) | `0000-0002-1825-0097` |
| `isni` | 16 characters, spaces allowed | ISO 7064 mod 11-2 | 16 characters, no spaces |
| `viaf` | Digits or `viaf.org/viaf/…` URL | `^\d+$` | Digits |
| `wikidata` | `Q42` or entity URL | `^Q\d+$` | `Q42` |
| `openlibrary` | `OL23919A` or `/authors/OL23919A` | `^OL\d+A$` | `OL23919A` |
| `semantic_scholar` | Author ID | `^\d+$` | Digits |

### 6.3 Contributors (authors, editors, and other roles)

#### How Calibre does it, and why Textus differs

Checked against Calibre's source (`resources/metadata_sqlite.sql`, `resources/default_tweaks.py`, `src/calibre/ebooks/metadata/__init__.py`):

- `authors(id, name TEXT COLLATE NOCASE UNIQUE, sort, link)` plus `books_authors_link(book, author)`. **An author is their name string.**
- No roles. Order is the insertion order of link rows.
- Sort strings come from heuristics: `author_sort_copy_method`, `author_name_suffixes` (Jr, Sr, III…), `author_name_prefixes` (Mr, Dr, Prof…), `author_name_copywords` (Inc., Society, Software… → corporate name, not inverted), `author_surname_prefixes` (van, von, de…).
- Author strings are split on `&` and `authors_split_regex` (`,? and `, `,? with `). A literal `&` is escaped as `&&`.

| Problem | Calibre | Textus |
|---------|---------|--------|
| Two people with the same name | Forced into one author (UNIQUE name) | Separate contributors; names are not unique |
| One person, several spellings (`J. Smith`, `John Smith`, `Smith, John A.`) | Separate authors until the user manually renames one onto the other | Name variants plus compatibility matching and a duplicate finder |
| Editors, translators, illustrators | No roles. Users add "(Editor)" to the name or use a custom column | A role on every credit |
| Order | Link insertion order | Explicit `position` per role |
| Sorting | Heuristic sort string per author and per book | Structured name parts; sort key derived and editable |
| Organizations | Copyword heuristic, only for sorting | `kind = 'organization'` |
| Pseudonyms | Unsupported | Pseudonym variants plus `credited_as` |
| Authority IDs | One URL (`link`) | ORCID, ISNI, VIAF, Wikidata, Open Library, Semantic Scholar |
| Name as printed on the book | Lost when the author is renamed | Kept per credit (`credited_as`) |
| Wrong merge | Irreversible | Split = move selected credits; "not the same person" is remembered |

Kept from Calibre: its suffix, prefix, copyword, and surname-particle lists seed the parser, and its `&` / `and` / `with` splitting is used for pasted input.

#### Model

```
contributors ───< contributor_names          variants, pseudonyms, transliterations
     │      └───< contributor_identifiers    ORCID, ISNI, VIAF, Wikidata, OL, S2
     │
     └───< record_contributors >─── records  the credit: role + position + name as printed
```

- **Contributor** — an identity: a person or an organization. Carries the preferred display form and structured name parts.
- **Name** — any other form the identity goes by. `name_type`: `variant` (`J. R. R. Tolkien` ↔ `John Ronald Reuel Tolkien`), `pseudonym` (`Richard Bachman` → Stephen King), `transliteration` (`Толстой` ↔ `Tolstoy`), `former`.
- **Credit** (`record_contributors`) — "contributor X had role R at position P on record Y". `credited_as` stores the name exactly as printed when it differs from the display name. `affiliation` stores the affiliation printed on a paper; it is also matching evidence.

Credits are **record-level**, because that is what is printed and editions differ: a revised edition adds a co-author, a translation adds a translator. When a new record is created under an existing work, `author` credits are pre-filled from the work's most recent record. Edition-specific roles (translator, editor, illustrator, introduction) are not copied.

#### Name structure

| Field | Person example | Notes |
|-------|---------------|-------|
| `display_name` | `J. R. R. Tolkien` | Preferred form, shown in the UI |
| `family_name` | `Tolkien` | Required for persons. Mononyms (`Plato`) use this field only |
| `given_names` | `John Ronald Reuel` | Initials allowed (`M. Necati`) |
| `particle` | `van`, `Le` | `Robin Le Poidevin` → family `Poidevin`, particle `Le` |
| `suffix` | `Jr.`, `III` | |
| `sort_name` | `Tolkien, John Ronald Reuel` | Derived, editable. Organizations: `display_name` |
| `match_key` | `tolkien` | Folded family name without particle. Organizations: folded full name |
| `birth_year` / `death_year` | `1942` | Parsed from authority forms like `Kreider, Jan F., 1942-`; also disambiguation evidence |

These fields map directly to CSL-JSON name objects (`family`, `given`, `non-dropping-particle`, `suffix`, or `literal` for organizations), so citation export needs no re-parsing.

**Folding** (`match_key` and all name comparisons): lowercase, NFKD, remove combining marks, then an explicit map for letters NFKD does not decompose — `ı→i`, `ø→o`, `ł→l`, `đ/ð→d`, `þ→th`, `ß→ss`, `æ→ae`, `œ→oe`. Finally keep letters only, so apostrophes and primes disappear (`Idelʹchik` = `Idelchik`, `Pis'mennyi` = `Pismennyi`, `Ó’Brógáin` = `obrogain`). Without the explicit map, Turkish `Özışık` and `Kakaç, Sadık` would never match `Ozisik` / `Sadik`.

#### Parsing names (`shared/names.ts`)

Providers that return structured names (Crossref `given`/`family`, ORCID) bypass parsing. Everything else — pasted text, EPUB `dc:creator`, the PDF Info `Author` field, file names — goes through `splitNames()` and then `parseName()`. The result is always shown as an editable preview; nothing parsed is saved without it, except during metadata apply, where parsed credits go through matching (below).

`splitNames(raw)`:
1. Clean: `_` → `.` (file-name escaping), strip quotes, strip Calibre sort hints in `[…]`, strip `†`, drop trailing periods on whole words, collapse whitespace.
2. Pull out leading role phrases that apply to every name: `edited by` → editor, `compiled by` → compiler, `translated by` → translator, `edited and with an introduction by` → editor + introduction.
3. If the string contains `;`, split on `;` only.
4. Otherwise, unless the whole string is an organization, split on `&`, `and`, `with` (Calibre's rule). Detect organizations *before* this split, or `National Council of Examiners for Engineering and Surveying` becomes two people.
5. Split each part on commas using greedy pairing. A single-word segment followed by another segment is `Family, Given` (plus an optional `, 1942-` date). Two segments where the second is a single word are also `Family, Given` (`Le Poidevin, Robin`). Any other segment is a full name. If a trailing segment is an organization, peel it off (`Rutkowski, Hank, Air Conditioning Contractors of America`). Drop initials-only fragments left by truncated lists.
6. Pull out per-name role markers: `(ed.)`, `(eds.)`, `(editor)`, `(trans.)`, `(auth.)`, `(author)`.
7. Remove duplicate credits within one record: same `match_key` and compatible given names.

`parseName(name)`:
- **Organization** if a word is in the organization list — Calibre's copywords plus `University, Collaboration, Consortium, Association, Foundation, Press, Ministry, Department, Organization, Group, GmbH, Ltd, LLC, AG, Gesellschaft, Verein, Contractors` — or the name is a single all-caps token (`OECD`).
- Remove honorifics: `Mr, Mrs, Ms, Dr, Prof, Professor, Sir`.
- A parenthesized fuller form (`Wilbur, Leslie C. (Leslie Clifford)`) is kept as a `variant` name.
- `Family, Given[, Suffix]` when there is a comma.
- Family-first initials (`Bergman T.L.`, `Choubey S.R.`): the first token is a word and all the others are initials.
- Otherwise the last token is the family name, preceded by any particles (`van, von, de, da, di, del, della, der, den, du, la, le, ten, ter, bin, ibn, al, el`). Suffix tokens must match `^(Jr|Sr|II|III|IV|PhD|MD)\.?$` on the raw token, so the initials `S.R.` are not read as `Sr`.
- All-caps names are title-cased for display (`BILLOWS, RICHARD` → `Richard Billows`). Mixed case is kept as is.

#### Roles

| Role | Meaning | CSL-JSON | biblatex | RIS |
|------|---------|----------|----------|-----|
| `author` | Created the content | `author` | `author` | `AU` |
| `editor` | Edited this record (edited volume, proceedings) | `editor` | `editor` | `ED` (`A2` for a chapter's container editors) |
| `compiler` | Compiled an anthology or collection | `compiler` | `editor` + `editortype = compiler` | `ED` |
| `translator` | Translated this edition | `translator` | `translator` | `A4` |
| `illustrator` | Illustrations | `illustrator` | `illustrator` | — |
| `series_editor` | Edits the series the record belongs to | `collection-editor` | `editora` + `editoratype = series` | `A3` |
| `introduction` | Foreword or introduction | — | `introduction` | — |
| `contributor` | Anything else | `contributor` | — | — |

Classic BibTeX has only `author` and `editor`. Other roles are dropped from that format and kept in biblatex. One person can hold several roles on the same record (the primary key includes `role`), e.g. editor + introduction.

#### Editors instead of authors

**Primary creators** are used for bylines, "sort by author", grouping, and citation keys. They are the credits of the first role that is present, in this order: `author` → `editor` → `compiler` → `translator`. This matches CSL's substitution rule (`editor`, then `translator`) plus `compiler` for anthologies. If none is present, sort by title.

Byline format (`formatByline()`):
- Cards: up to three primary creators, then `et al.`. Non-author roles get a suffix: `(ed.)`/`(eds.)`, `(comp.)`, `(trans.)`.
- Detail page, grouped by role: *By …* · *Edited by …* · *Compiled by …* · *Translated by …* · *Illustrated by …* · *Introduction by …* · *Series editor …*.
- When `credited_as` differs from the display name, show the printed form first: `Richard Bachman (pseudonym of Stephen King)`.
- Contributor page groups credits by role: *As author (12) · As editor (3) · As translator (1)*.

**Edited volumes and chapters** use `records.container_record_id`:
- The edited book is a `book` work with an `edition` record carrying `editor` credits (and no authors).
- A chapter the user wants to track is its own `chapter` work with a `chapter` record whose `container_record_id` points to the edited book's record. The chapter carries its own `author` credits.
- The container's editors are **never copied** onto chapters. Citation export reads container title, editors, publisher, and date from the container record.
- A journal article inside a stored issue uses the same link (`container_record_id` → the `issue` record). If the journal is not in the library, its title is stored in `records.metadata.container_title` and no container is created.

| Case | Modeling |
|------|----------|
| Single-author novel | `book` work → `edition` record → `author` |
| Edited handbook, chapters by others | `book` work → `edition` record → `editor` × n; optional `chapter` records inside it with their own authors |
| Translated edition | New `edition` record under the same work: `author` (pre-filled) + `translator` |
| Editor who also wrote the introduction | Two credits for the same contributor: `editor` and `introduction` |
| Conference proceedings | `book` (or `report`) work with `editor` credits; papers as `chapter` records inside it |
| Osprey-style title (author + illustrator) | `author` + `illustrator` credits |
| Vendor manual | `organization` contributor as `author` |

#### Matching imported names to existing contributors

Matching runs whenever credits come from outside: metadata apply, file extraction, and bulk import. Its goal is **no false merges**. A wrong split is one click to merge later. A wrong merge silently puts one person's works into another person's bibliography. So when in doubt, the matcher creates a new *provisional* contributor and suggests the candidate.

1. **External identifier.** If a contributor in the library has the same ORCID, ISNI, VIAF, Wikidata, Open Library, or Semantic Scholar ID, link to it (`resolved_by = 'identifier'`). A *different* value for the same scheme excludes that candidate.
2. **Candidates** are contributors whose `match_key`, or one of whose names' `match_key`, equals the incoming key. For organizations the folded full name must match exactly; they skip the rest of this list.
3. **Name compatibility** (`compareGiven(a, b)`): tokenize given names on spaces, periods, and hyphens (`J.-P.` → `j`, `p`), then compare pairwise from the left.
   - `exact`: all tokens equal.
   - `full`: the first token is spelled out and equal, and the remaining tokens are equal or an initial matches (`Carl` ~ `Carl F.`).
   - `initials`: compatible, but only through initials (`C. T.` ~ `Clayton T.`), or one side has no given names.
   - `incompatible`: any pair differs (`Mehmet` vs `Nurdan Demirci`). The candidate is excluded.
   - Candidates whose birth year is after the publication year are also excluded.
4. **Score:** `exact` +3, `full` +2, `initials` +1; already credited on another record of the same work +4; each shared co-author (by `match_key`) +2, counting at most 2; same normalized affiliation +2.
5. **Decide:**
   - **Link** (`resolved_by = 'match'`) if there is exactly one candidate and the name is `exact` or `full`, or if the best score is ≥ 5 and at least 2 above the runner-up.
   - **Provisional:** otherwise, if any candidate exists, create a new contributor with `status = 'provisional'`. It appears in the review queue as "possibly the same as …".
   - **New:** if there is no candidate, create a new contributor (`resolved_by = 'new'`).
6. Names from the PDF Info `Author` field that are a single token, a username, or junk (see validation below) never create contributors automatically. They are only shown as suggestions.

The score constants live in one place in `shared/names.ts` as the calibration knob. This is deliberately rules-based, not ML or embeddings: the candidate sets are small, and explicit evidence (identifiers, co-authors, works, affiliations) is stronger and can be explained ("linked: same ORCID", "linked: shares 2 co-authors").

| Incoming credit | Library state | Result |
|-----------------|---------------|--------|
| `Yunus A. Çengel` | `Yunus Cengel` | Link (`full`; `ç` folds to `c`) |
| `Carl F. Elgh` | `Carl Elgh` | Link (`full`) |
| `S.A. Klein` | `Sandy KLein` | Provisional, review: "possibly Sandy Klein". Correct — it is the same person, but `Sandy` is a nickname |
| `Sankir, Nurdan Demirci` | `Sankir, Mehmet` | New (`incompatible`); different people sharing a surname |
| `J. Smith` on a paper, ORCID X | `John Smith` with ORCID X | Link (identifier) |
| `John Smith` | Two `John Smith`s marked distinct; the paper shares 2 co-authors with one | Link to that one (score 7 vs 3) |
| `John Smith` | Same as above, no other evidence | Provisional, review |
| `Richard Bachman` | Stephen King with pseudonym variant `Richard Bachman` | Link to King; `credited_as = 'Richard Bachman'` |

#### Merge, split, review

- **Merge** (`merge_contributors(keep, merge, force)`): moves credits, names, and identifiers to `keep`, and adds the merged display name as a variant of `keep`. It is refused if the two have different values for the same identifier scheme, unless `force` is set.
- **Split** (`reassign_credits(from, to, record_ids)`): moves selected credits to another contributor, which the UI may create first. It records a `contributor_distinctions` row so the pair is never suggested again. This is also how a wrong merge is undone.
- **Review queue:** provisional contributors, plus `possible_duplicate_contributors()`. That function returns pairs with the same `match_key`, no recorded distinction, and no conflicting identifiers; `compareGiven` then filters them client-side. Each pair offers three actions: *Same person* (merge), *Different people* (distinction), and *Skip*.

#### Validation against a real library

Before being written down, the rules above were prototyped and run against a real 282-file collection (272 PDF, 9 EPUB, 1 MOBI) containing engineering textbooks, handbooks, history books, papers, magazines, and vendor manuals. The results shaped the rules:

| Observation | Count / example | Rule it produced |
|-------------|-----------------|------------------|
| No usable embedded author | 84 of 282 files (30%) | Identifier lookup is the primary path, not file metadata |
| Identifier discoverable | ISBN in file name or EPUB: 58. ISBN in the first 8 PDF pages: 52. DOI: 2. Scans without text: 17 | Extract ISBN/DOI from the first pages' text (`extract_text` job) and from file names |
| Junk in the PDF `Author` field | `CamScanner`, OS usernames (`anand`, `nmorris`), `dynstab2/ThePirateBay`, KOI8 bytes decoded wrongly (`Администратор` → `\x104<8=8AB@0B>@`), a lecture title, `Unknown` | Junk filter: control characters, lowercase single tokens, paths/URLs, long digit runs, known app names. Such values are suggestions only |
| Organizations as authors | 113 credits, 8 organizations (one vendor on ~150 manuals), `"ETAS GmbH"`, `OECD` | `kind = organization`; organization detection before splitting on `and` |
| Mixed separators | `A;B;C;`, `A, B and C`, `A & B`, `Fam, G, Fam, G`, `Bergman T.L., Lavine A.S.` | Splitting steps 3–5 above |
| Editors mislabelled as authors | An edited volume's editors were tagged as authors in the PDF, the EPUB (plus the title leaked `Edited by`), and Open Library. An illustrator was tagged `aut` in an EPUB | Don't trust roles from files. Prefer Crossref, which separates `author`/`editor`. Parse `by_statement` from Open Library |
| Same person, different spellings | `Çengel`/`Cengel`, `Kanoğlu`/`Kanoglu`, `Thulukkanam, Kuppan`/`Kuppan Thulukkanam`, `Hibbeler, Russell`/`Russell C Hibbeler`/`Russell C. Hibbeler` | Folding plus `compareGiven`: 21 credits linked, 0 false merges, 1 correct provisional (Klein) |
| Duplicates within one record | The EPUB listed editors both joined with `;` and separately; file names repeat names in both orders | Dedupe credits per record |
| Authority-style names | `Kreider, Jan F., 1942-`, `Wilbur, Leslie C. (Leslie Clifford)`, `Anders†` (Crossref) | Parse birth year, fuller form, strip `†` |

Crossref returned structured `given`/`family`, ORCIDs, and author `sequence` for the papers, and registers both edited books in the collection chapter by chapter with per-chapter authors — which confirms the container/chapter model. Google Books' unauthenticated shared quota was exhausted during the check, so it is only usable with an API key.

**Known limits** (the user edits the preview):
- Spanish/Portuguese double surnames in natural order (`Abel Arrieta Castro` parses as family `Castro`).
- Nicknames (`Sandy` for Sanford).
- Run-together usernames (`QuangNguyen`).
- Lists truncated by file-name length (a trailing lone `Ignacio`).
- East Asian names without separators.

**Golden test cases** for `shared/names.ts` (taken from the validation set):

| Input | Expected |
|-------|----------|
| `Crowe, Clayton T_ ;Schwarzkopf, John D_ ;Sommerfeld, Martin` | 3 persons: Crowe / Clayton T.; Schwarzkopf / John D.; Sommerfeld / Martin |
| `Krishan Arora, Suman Lata Tripathi and Himanshu Sharma` | 3 persons; Tripathi / given `Suman Lata` |
| `Idelʹchik, I_ E, Steinberg, M_ O` | 2 persons: Idelʹchik / I. E; Steinberg / M. O |
| `Bergman T_L_, Lavine A_S_, Incropera F_P_, DeWitt D_P_` | 4 persons, family-first initials |
| `Avadhanulu M_N_ & Choubey S_R_` | Choubey / given `S.R.` (no suffix `Sr`) |
| `Sadik Kakaç, Hongtan Liu, Anchasa Pramuanjaroenkij, S_` | 3 persons; truncated `S.` dropped |
| `Le Poidevin, Robin` | family `Poidevin`, particle `Le`, given `Robin`, match key `poidevin` |
| `Rutkowski, Hank, Air Conditioning Contractors of America` | person Rutkowski / Hank + organization |
| `National Council of Examiners for Engineering and Surveying` | 1 organization (not split on `and`) |
| `edited and with an introduction by Sander L_ Gilman` | Gilman / Sander L., roles editor + introduction |
| `Alawad, Suhaib M_ (author);Mansour, Ridha Ben` | Alawad / Suhaib M.; Mansour / `Ridha Ben` (matches Crossref) |
| `Claudia Alves & Alexander Aronowitz [Alves, Claudia]` | 2 persons; sort hint removed |
| `Miller, Donald S_, Donald S_ Miller` | 1 person after dedupe |
| `Kreider, Jan F_, 1942-` | Kreider / Jan F., birth year 1942 |
| `Professor Dr_ Karl Stephan (auth_)` | Stephan / Karl, role author |
| `M_ Necati Özışık` | match key `ozisik` |
| `"ETAS GmbH"`, `OECD`, `Siemens PLM Software` | organizations |
| `CamScanner`, `anand`, `dynstab2/ThePirateBay`, `isbn13 9780367904258` | rejected as junk |
| `Sankir, Mehmet` vs `Sankir, Nurdan Demirci` | `compareGiven` → `incompatible` |
| `C. T.` vs `Clayton T.`; `Carl` vs `Carl F.` | `initials`; `full` |

---

## 7. Database schema

19 tables: 18 domain tables plus `jobs` (`saved_searches`, FR-ORG-5, was added in a later migration). The SQL below is the target state of the initial migrations and must be implemented as written; changes go through new migrations and an update to this section.

### 7.1 Tables

```sql
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
    work_type TEXT NOT NULL CHECK (work_type IN ('book', 'article', 'chapter', 'serial', 'thesis', 'report', 'standard', 'other')),
    title TEXT NOT NULL,
    subtitle TEXT,
    abstract TEXT,
    language TEXT DEFAULT 'en',
    user_rating SMALLINT CHECK (user_rating BETWEEN 1 AND 5), -- Optional owner rating for books
    metadata JSONB NOT NULL DEFAULT '{}', -- locked_fields for manually edited work fields (added in migration 00007)
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

Migration `20260928000008` marks pre-M2 manually entered work and record fields as locked, including existing credits, so a newly fetched suggestion cannot overwrite legacy user data by default.

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
        'standard',         -- Technical standard / revision
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
    metadata JSONB DEFAULT '{}', -- Type-specific extras: container_title, version, degree, locked_fields (FR-META-3), contributors_incomplete
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
    scheme TEXT NOT NULL CHECK (scheme IN ('isbn', 'doi', 'issn', 'arxiv', 'pmid', 'iso', 'iec', 'astm', 'asme', 'bs')),
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
-- 14b. SAVED_SEARCHES (FR-ORG-5, migration 20260929000001)
-- ==========================================
CREATE TABLE saved_searches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
    filters JSONB NOT NULL DEFAULT '{}', -- library filter/sort state, validated with Zod in the SPA
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
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
```

### 7.2 Functions and triggers

```sql
-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER works_updated_at          BEFORE UPDATE ON works          FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER contributors_updated_at   BEFORE UPDATE ON contributors   FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER records_updated_at        BEFORE UPDATE ON records        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER assets_updated_at         BEFORE UPDATE ON assets         FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER collections_updated_at    BEFORE UPDATE ON collections    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER reading_states_updated_at BEFORE UPDATE ON reading_states FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER annotations_updated_at    BEFORE UPDATE ON annotations    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Asset immutability: enforced for every role, including service_role.
-- Only processing_state, processing_error, metadata, updated_at may change.
CREATE OR REPLACE FUNCTION public.prevent_asset_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF (NEW.user_id, NEW.bucket, NEW.storage_path, NEW.file_size, NEW.checksum_sha256, NEW.mime_type, NEW.file_format)
       IS DISTINCT FROM
       (OLD.user_id, OLD.bucket, OLD.storage_path, OLD.file_size, OLD.checksum_sha256, OLD.mime_type, OLD.file_format) THEN
        RAISE EXCEPTION 'assets are immutable; create a new asset instead';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER assets_immutable BEFORE UPDATE ON assets
    FOR EACH ROW EXECUTE FUNCTION prevent_asset_mutation();

-- Ownership check for record-scoped rows. SECURITY DEFINER avoids nested RLS
-- evaluation; it only ever answers for the calling user.
CREATE OR REPLACE FUNCTION private.is_record_owner(p_record_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.records r
        JOIN public.works w ON w.id = r.work_id
        WHERE r.id = p_record_id AND w.user_id = (SELECT auth.uid())
    );
$$;

-- Job claiming for the worker (service role only).
-- ponytail: jobs whose lease expired at max_attempts stay 'running'; the worker marks them failed.
CREATE OR REPLACE FUNCTION public.claim_jobs(p_limit INT DEFAULT 5, p_lease INTERVAL DEFAULT '5 minutes')
RETURNS SETOF public.jobs LANGUAGE sql SET search_path = '' AS $$
    UPDATE public.jobs j
    SET status = 'running',
        attempts = j.attempts + 1,
        started_at = NOW(),
        lease_expires_at = NOW() + p_lease
    WHERE j.id IN (
        SELECT id FROM public.jobs
        WHERE attempts < max_attempts
          AND (status = 'queued' OR (status = 'running' AND lease_expires_at < NOW()))
        ORDER BY created_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING j.*;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_jobs(INT, INTERVAL) FROM PUBLIC, anon, authenticated;
```

Contributor functions (§6.3). All are `SECURITY INVOKER`: RLS applies, so a caller can only touch their own rows.

```sql
-- Replace a record's whole credit list atomically. The contributor editor saves through this,
-- so reordering never trips UNIQUE (record_id, role, position).
CREATE OR REPLACE FUNCTION public.set_record_contributors(p_record_id UUID, p_credits JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF NOT private.is_record_owner(p_record_id) THEN
        RAISE EXCEPTION 'record not found';
    END IF;
    DELETE FROM public.record_contributors WHERE record_id = p_record_id;
    INSERT INTO public.record_contributors
        (record_id, contributor_id, role, position, credited_as, affiliation, resolved_by)
    SELECT p_record_id, c.contributor_id, c.role, c.position, c.credited_as, c.affiliation, coalesce(c.resolved_by, 'user')
    FROM jsonb_to_recordset(p_credits)
        AS c(contributor_id UUID, role TEXT, position INT, credited_as TEXT, affiliation TEXT, resolved_by TEXT);
END;
$$;

-- Merge p_merge into p_keep. Refuses conflicting external IDs unless p_force.
CREATE OR REPLACE FUNCTION public.merge_contributors(p_keep UUID, p_merge UUID, p_force BOOLEAN DEFAULT FALSE)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    IF p_keep = p_merge THEN
        RAISE EXCEPTION 'cannot merge a contributor into itself';
    END IF;
    IF (SELECT count(*) FROM public.contributors WHERE id IN (p_keep, p_merge)) <> 2 THEN
        RAISE EXCEPTION 'contributor not found';
    END IF;
    IF NOT p_force AND EXISTS (
        SELECT 1 FROM public.contributor_identifiers k
        JOIN public.contributor_identifiers m ON m.scheme = k.scheme AND m.value <> k.value
        WHERE k.contributor_id = p_keep AND m.contributor_id = p_merge
    ) THEN
        RAISE EXCEPTION 'conflicting external identifiers; these look like different people';
    END IF;

    -- Credits: drop ones p_keep already holds on the same record and role, move the rest.
    DELETE FROM public.record_contributors m
    USING public.record_contributors k
    WHERE m.contributor_id = p_merge AND k.contributor_id = p_keep
      AND k.record_id = m.record_id AND k.role = m.role;
    UPDATE public.record_contributors SET contributor_id = p_keep WHERE contributor_id = p_merge;

    -- Names: the merged display name and its variants become variants of p_keep.
    INSERT INTO public.contributor_names (user_id, contributor_id, name, match_key, name_type)
    SELECT user_id, p_keep, display_name, match_key, 'variant' FROM public.contributors WHERE id = p_merge
    UNION ALL
    SELECT user_id, p_keep, name, match_key, name_type FROM public.contributor_names WHERE contributor_id = p_merge
    ON CONFLICT (contributor_id, name) DO NOTHING;

    UPDATE public.contributor_identifiers SET contributor_id = p_keep WHERE contributor_id = p_merge;
    DELETE FROM public.contributors WHERE id = p_merge; -- cascades leftover names and distinctions
END;
$$;

-- Split: move selected credits to another contributor and remember that the two differ.
CREATE OR REPLACE FUNCTION public.reassign_credits(p_from UUID, p_to UUID, p_record_ids UUID[])
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
    UPDATE public.record_contributors SET contributor_id = p_to, resolved_by = 'user'
    WHERE contributor_id = p_from AND record_id = ANY(p_record_ids);
    INSERT INTO public.contributor_distinctions (user_id, contributor_a, contributor_b)
    VALUES ((SELECT auth.uid()), LEAST(p_from, p_to), GREATEST(p_from, p_to))
    ON CONFLICT DO NOTHING;
END;
$$;

-- Matching candidates with their evidence (§6.3). Scoring happens in shared/names.ts.
-- ponytail: co-author/affiliation arrays are unbounded; cap them if large-collaboration papers make this slow.
CREATE OR REPLACE FUNCTION public.contributor_candidates(p_match_keys TEXT[])
RETURNS TABLE (
    contributor_id UUID, match_key TEXT, kind TEXT, display_name TEXT, given_names TEXT,
    birth_year SMALLINT, death_year SMALLINT, names TEXT[],
    identifiers JSONB, coauthor_keys TEXT[], affiliations TEXT[], work_ids UUID[]
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    WITH hits AS (
        SELECT c.id, c.match_key FROM public.contributors c WHERE c.match_key = ANY(p_match_keys)
        UNION
        SELECT n.contributor_id, n.match_key FROM public.contributor_names n WHERE n.match_key = ANY(p_match_keys)
    )
    SELECT c.id, h.match_key, c.kind, c.display_name, c.given_names, c.birth_year, c.death_year,
        ARRAY(SELECT n.name FROM public.contributor_names n WHERE n.contributor_id = c.id),
        (SELECT coalesce(jsonb_object_agg(i.scheme, i.value), '{}'::jsonb)
           FROM public.contributor_identifiers i WHERE i.contributor_id = c.id),
        ARRAY(SELECT DISTINCT o.match_key
              FROM public.record_contributors rc
              JOIN public.record_contributors rc2 ON rc2.record_id = rc.record_id AND rc2.contributor_id <> c.id
              JOIN public.contributors o ON o.id = rc2.contributor_id
              WHERE rc.contributor_id = c.id),
        ARRAY(SELECT DISTINCT rc.affiliation FROM public.record_contributors rc
              WHERE rc.contributor_id = c.id AND rc.affiliation IS NOT NULL),
        ARRAY(SELECT DISTINCT r.work_id FROM public.record_contributors rc
              JOIN public.records r ON r.id = rc.record_id WHERE rc.contributor_id = c.id)
    FROM hits h JOIN public.contributors c ON c.id = h.id;
$$;

-- Review queue: same-key pairs without a recorded distinction or conflicting IDs.
-- Given-name compatibility is checked client-side with compareGiven().
CREATE OR REPLACE FUNCTION public.possible_duplicate_contributors()
RETURNS TABLE (contributor_a UUID, contributor_b UUID)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    SELECT a.id, b.id
    FROM public.contributors a
    JOIN public.contributors b ON b.user_id = a.user_id AND b.match_key = a.match_key AND a.id < b.id
    WHERE NOT EXISTS (SELECT 1 FROM public.contributor_distinctions d
                      WHERE d.contributor_a = a.id AND d.contributor_b = b.id)
      AND NOT EXISTS (SELECT 1 FROM public.contributor_identifiers ia
                      JOIN public.contributor_identifiers ib ON ib.scheme = ia.scheme AND ib.value <> ia.value
                      WHERE ia.contributor_id = a.id AND ib.contributor_id = b.id);
$$;
```

### 7.3 Row-Level Security

Rule: every table has RLS enabled. An operation without a policy is **deliberately** denied to clients and performed by Edge Functions with the service role. Those deliberate denials are listed in the comments.

```sql
-- ---------- Owner-scoped tables (user_id column) ----------
-- works, contributors, tags, collections, saved_searches, reading_states, annotations
-- (reading_states and annotations also require an owned record and asset on INSERT/UPDATE: migration 20260929000002)
-- saved_searches: select/insert/update/delete own rows, same shape as tags

ALTER TABLE works ENABLE ROW LEVEL SECURITY;
CREATE POLICY "works_select_own" ON works FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "works_insert_own" ON works FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "works_update_own" ON works FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "works_delete_own" ON works FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

ALTER TABLE contributors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contributors_select_own" ON contributors FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "contributors_insert_own" ON contributors FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "contributors_update_own" ON contributors FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "contributors_delete_own" ON contributors FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tags_select_own" ON tags FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "tags_insert_own" ON tags FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "tags_update_own" ON tags FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "tags_delete_own" ON tags FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collections_select_own" ON collections FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "collections_insert_own" ON collections FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "collections_update_own" ON collections FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "collections_delete_own" ON collections FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

ALTER TABLE reading_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reading_states_select_own" ON reading_states FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "reading_states_insert_own" ON reading_states FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "reading_states_update_own" ON reading_states FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "reading_states_delete_own" ON reading_states FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "annotations_select_own" ON annotations FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "annotations_insert_own" ON annotations FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "annotations_update_own" ON annotations FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "annotations_delete_own" ON annotations FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ---------- RECORDS (ownership via work) ----------
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "records_select" ON records FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM works w WHERE w.id = records.work_id AND w.user_id = (SELECT auth.uid()))
);
CREATE POLICY "records_insert" ON records FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM works w WHERE w.id = records.work_id AND w.user_id = (SELECT auth.uid()))
    AND (container_record_id IS NULL OR private.is_record_owner(container_record_id))
);
CREATE POLICY "records_update" ON records FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM works w WHERE w.id = records.work_id AND w.user_id = (SELECT auth.uid()))
) WITH CHECK (
    EXISTS (SELECT 1 FROM works w WHERE w.id = records.work_id AND w.user_id = (SELECT auth.uid()))
    AND (container_record_id IS NULL OR private.is_record_owner(container_record_id))
);
CREATE POLICY "records_delete" ON records FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM works w WHERE w.id = records.work_id AND w.user_id = (SELECT auth.uid()))
);

-- ---------- IDENTIFIERS (ownership via record) ----------
ALTER TABLE identifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "identifiers_select" ON identifiers FOR SELECT TO authenticated USING (private.is_record_owner(record_id));
CREATE POLICY "identifiers_insert" ON identifiers FOR INSERT TO authenticated WITH CHECK (private.is_record_owner(record_id));
CREATE POLICY "identifiers_update" ON identifiers FOR UPDATE TO authenticated USING (private.is_record_owner(record_id)) WITH CHECK (private.is_record_owner(record_id));
CREATE POLICY "identifiers_delete" ON identifiers FOR DELETE TO authenticated USING (private.is_record_owner(record_id));

-- ---------- RECORD_CONTRIBUTORS ----------
ALTER TABLE record_contributors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "record_contributors_select" ON record_contributors FOR SELECT TO authenticated USING (private.is_record_owner(record_id));
CREATE POLICY "record_contributors_insert" ON record_contributors FOR INSERT TO authenticated WITH CHECK (
    private.is_record_owner(record_id)
    AND EXISTS (SELECT 1 FROM contributors c WHERE c.id = contributor_id AND c.user_id = (SELECT auth.uid()))
);
CREATE POLICY "record_contributors_update" ON record_contributors FOR UPDATE TO authenticated
    USING (private.is_record_owner(record_id))
    WITH CHECK (
        private.is_record_owner(record_id)
        AND EXISTS (SELECT 1 FROM contributors c WHERE c.id = contributor_id AND c.user_id = (SELECT auth.uid()))
    );
CREATE POLICY "record_contributors_delete" ON record_contributors FOR DELETE TO authenticated USING (private.is_record_owner(record_id));

-- ---------- CONTRIBUTOR_NAMES / CONTRIBUTOR_IDENTIFIERS (own rows, own contributor) ----------
ALTER TABLE contributor_names ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contributor_names_select_own" ON contributor_names FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "contributor_names_insert_own" ON contributor_names FOR INSERT TO authenticated WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM contributors c WHERE c.id = contributor_id AND c.user_id = (SELECT auth.uid()))
);
CREATE POLICY "contributor_names_update_own" ON contributor_names FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK (
        (SELECT auth.uid()) = user_id
        AND EXISTS (SELECT 1 FROM contributors c WHERE c.id = contributor_id AND c.user_id = (SELECT auth.uid()))
    );
CREATE POLICY "contributor_names_delete_own" ON contributor_names FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

ALTER TABLE contributor_identifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contributor_identifiers_select_own" ON contributor_identifiers FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "contributor_identifiers_insert_own" ON contributor_identifiers FOR INSERT TO authenticated WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM contributors c WHERE c.id = contributor_id AND c.user_id = (SELECT auth.uid()))
);
CREATE POLICY "contributor_identifiers_update_own" ON contributor_identifiers FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = user_id)
    WITH CHECK (
        (SELECT auth.uid()) = user_id
        AND EXISTS (SELECT 1 FROM contributors c WHERE c.id = contributor_id AND c.user_id = (SELECT auth.uid()))
    );
CREATE POLICY "contributor_identifiers_delete_own" ON contributor_identifiers FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ---------- CONTRIBUTOR_DISTINCTIONS (no UPDATE: rows are facts, delete to undo) ----------
ALTER TABLE contributor_distinctions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contributor_distinctions_select_own" ON contributor_distinctions FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "contributor_distinctions_insert_own" ON contributor_distinctions FOR INSERT TO authenticated WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (SELECT count(*) FROM contributors c
         WHERE c.id IN (contributor_a, contributor_b) AND c.user_id = (SELECT auth.uid())) = 2
);
CREATE POLICY "contributor_distinctions_delete_own" ON contributor_distinctions FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ---------- ASSETS ----------
-- Clients: SELECT only. INSERT (after upload verification), UPDATE (processing state)
-- and DELETE (garbage collection of unreferenced assets) are service-role only.
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assets_select_own" ON assets FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ---------- RECORD_ASSETS ----------
-- Clients may view and unlink. Linking happens in the upload function (service role).
ALTER TABLE record_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "record_assets_select" ON record_assets FOR SELECT TO authenticated USING (private.is_record_owner(record_id));
CREATE POLICY "record_assets_delete" ON record_assets FOR DELETE TO authenticated USING (private.is_record_owner(record_id));

-- ---------- RECORD_TAGS ----------
ALTER TABLE record_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "record_tags_select" ON record_tags FOR SELECT TO authenticated USING (private.is_record_owner(record_id));
CREATE POLICY "record_tags_insert" ON record_tags FOR INSERT TO authenticated WITH CHECK (
    private.is_record_owner(record_id)
    AND EXISTS (SELECT 1 FROM tags t WHERE t.id = tag_id AND t.user_id = (SELECT auth.uid()))
);
CREATE POLICY "record_tags_delete" ON record_tags FOR DELETE TO authenticated USING (private.is_record_owner(record_id));

-- ---------- COLLECTION_RECORDS ----------
ALTER TABLE collection_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collection_records_select" ON collection_records FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM collections c WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid()))
);
CREATE POLICY "collection_records_insert" ON collection_records FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM collections c WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid()))
    AND private.is_record_owner(record_id)
);
CREATE POLICY "collection_records_update" ON collection_records FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM collections c WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid())))
    WITH CHECK (
        EXISTS (SELECT 1 FROM collections c WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid()))
        AND private.is_record_owner(record_id)
    );
CREATE POLICY "collection_records_delete" ON collection_records FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM collections c WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid()))
);

-- ---------- METADATA_CACHE ----------
-- Readable by signed-in users; written only by Edge Functions (service role).
ALTER TABLE metadata_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "metadata_cache_select" ON metadata_cache FOR SELECT TO authenticated USING (TRUE);

-- ---------- JOBS ----------
-- Users can see their own jobs (progress UI). All writes via service role.
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jobs_select_own" ON jobs FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
```

### 7.4 Storage

| Bucket | Public | Size limit | Contents | Path |
|--------|--------|-----------|----------|------|
| `documents` | No | 500 MB | Verified document files | `{user_id}/{sha256}.{ext}` |
| `covers` | No | 5 MB | Covers and thumbnails | `{user_id}/{sha256}.{ext}` |
| `staging` | No | 500 MB | In-progress uploads | `{user_id}/{upload_id}/{filename}` |

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
    ('documents', 'documents', FALSE, 524288000, ARRAY[
        'application/pdf', 'application/epub+zip', 'application/x-mobipocket-ebook',
        'application/vnd.amazon.ebook', 'application/vnd.comicbook+zip', 'text/html', 'text/plain']),
    ('covers', 'covers', FALSE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
    ('staging', 'staging', FALSE, 524288000, NULL) -- type is detected server-side after upload
ON CONFLICT (id) DO NOTHING;

-- Clients read their own files (needed to create signed URLs with the user's JWT).
CREATE POLICY "documents_select_own" ON storage.objects FOR SELECT TO authenticated USING (
    bucket_id = 'documents' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);
CREATE POLICY "covers_select_own" ON storage.objects FOR SELECT TO authenticated USING (
    bucket_id = 'covers' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);
-- No client INSERT/UPDATE/DELETE on any bucket:
--   staging  → clients upload through server-issued signed upload URLs
--   documents/covers → written and deleted only by Edge Functions
```

Signed URLs for reading are valid for **300 seconds**:

```typescript
const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 300);
// Never: getPublicUrl() — no bucket is public.
```

### 7.5 Worker schedule (environment-specific, not in migrations)

The job worker is triggered every minute by `pg_cron` through `pg_net`. The service role key is read from Supabase Vault, never hard-coded:

```sql
SELECT cron.schedule('job-worker', '* * * * *', $$
    SELECT net.http_post(
        url := '<SUPABASE_URL>/functions/v1/job-worker',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
        )
    );
$$);
```

---

## 8. Edge Functions

All functions:
- validate input with Zod and return `400` with a reason on failure;
- return CORS headers on **every** response, including errors and `OPTIONS`;
- authenticate the caller from the `Authorization` JWT (except `job-worker`, which requires the service role, and `opds`, which authenticates e-readers with HTTP Basic, §8.5);
- build URLs with `URL` / `URLSearchParams`, never string concatenation;
- use `AbortSignal.timeout(10_000)` on every outbound fetch and cap response size at 5 MB;
- log technical details server-side; return user-safe messages.

Shared code lives in `supabase/functions/_shared/` (CORS, auth, Zod schemas, identifier validation, providers).

### 8.1 `metadata-lookup`

Fetches and normalizes metadata for one identifier.

```typescript
interface MetadataRequest {
    identifier: { scheme: IdentifierScheme; value: string };
    bypassCache?: boolean;
}

type MetadataResponse =
    | { status: 'success'; data: NormalizedMetadata; fromCache: boolean; fetchedAt: string }
    | { status: 'not_found'; identifier: string; searchedProviders: string[] }
    | { status: 'invalid_identifier'; scheme: string; reason: string }
    | { status: 'rate_limited'; retryAfterMs: number; provider: string }
    | { status: 'provider_error'; provider: string; message: string };
```

Steps:
1. Validate and normalize the identifier ([§6.2](#62-identifier-rules)). Invalid → `invalid_identifier` without any network call.
2. Check `metadata_cache` (unless `bypassCache`).
3. Try providers in the order given for the scheme in [§10](#10-external-metadata-providers). Move to the next provider on `not_found` or `provider_error`; stop on `success`.
4. Parse the real response into `NormalizedMetadata`, including Crossref `container-title` and Semantic Scholar `journal.name`. Store the chosen journal/container title in `records.metadata.container_title`, preserving other metadata and manual locks. Cached results predating container-title parsing are refreshed. **Never return placeholder or mock data.** If a response cannot be parsed, that is `provider_error`.
5. Cache successes (default TTL 30 days).
6. On HTTP 429, honor `Retry-After`; return `rate_limited` if no other provider remains.

The `switch` over schemes must be exhaustive (TypeScript `never` check) — every scheme has a real implementation.

The same authenticated function also accepts `{ action: 'queue-cover', recordId, url }`. It verifies record ownership and an Open Library cover URL before queuing `process_cover`; clients cannot write jobs directly. Open Library ISBN URLs redirect within `openlibrary.org`, and cover URLs may redirect through `archive.org` to `*.us.archive.org`; each hop is checked against the allowlist.

### 8.2 `upload`

Two actions on one function: `intent` and `complete`. See [§9.1](#91-upload).

```typescript
// POST /upload/intent
interface UploadIntentRequest {
    uploadId: string;          // client-generated UUID; idempotency key
    recordId: string;
    filename: string;
    size: number;              // bytes, checked against bucket limit
}
interface UploadIntentResponse { path: string; token: string } // for uploadToSignedUrl

// POST /upload/complete
interface UploadCompleteRequest {
    uploadId: string;
    recordId: string;
    role: 'primary' | 'supplement' | 'cover';
    filename?: string;         // used only for identifier suggestions; never for storage paths
}
type UploadCompleteResponse =
    | { status: 'created'; asset: AssetRow }
    | { status: 'deduplicated'; asset: AssetRow }  // bytes already existed; linked the existing asset
    | { status: 'rejected'; reason: 'missing' | 'size_mismatch' | 'unsupported_type' };
```

### 8.3 `job-worker`

Invoked by `pg_cron` ([§7.5](#75-worker-schedule-environment-specific-not-in-migrations)). Calls `claim_jobs()`, runs each job, sets `succeeded` / `failed` with `result` / `last_error`, and marks expired jobs at `max_attempts` as `failed`.

| Job type | Does |
|----------|------|
| `extract_text` | Extracts text from PDF/EPUB, stores stats in `assets.metadata`, and feeds search. Scans the first 8 pages for ISBN/DOI and the file's own metadata (PDF Info, EPUB OPF) for credit suggestions (§6.3), then queues `fetch_metadata` when an identifier is found |
| `generate_thumbnail` | Renders a thumbnail (PDF first page / EPUB cover) as a new `covers` asset with role `thumbnail` |
| `fetch_metadata` | Runs a lookup for a record's primary identifier and stores the result as a suggestion |
| `process_cover` | Downloads a provider cover URL (allowlisted host), stores it as a `cover` asset |
| `export_data` | Produces a bulk export file |
| `cleanup` | Deletes staging files older than 24 h and assets no longer referenced by any `record_assets` row (row + object) |

Asset state transitions: `pending` → `processing` (first job claimed) → `ready` (all required jobs succeeded) or `failed` (with `processing_error`).

### 8.4 `export`

`POST { recordIds: uuid[] (1–500), format: 'bibtex' | 'ris' | 'csl-json' }` → `{ format, filename, mime, content, count }`. Generates citations for records the caller owns (M5, FR-RES-1). `user` auth with the RLS-scoped client only — ids the caller does not own come back missing, and there is no service-role access. Formatting lives in `_shared/citations.ts` (re-exported by `shared/citations.ts` for tests). Bylines follow FR-CONTRIB-4; for a chapter or article the container title, editors, publisher and date are read from `container_record_id` and never copied onto the chapter (§6.3). Annotation export (Markdown/JSON) is generated client-side from data the user can already read.

### 8.5 `opds`

An OPDS 1.2 catalog for e-reader apps (FR-SER-3). Routes under `/functions/v1/opds`: `` (start, a navigation feed), `all` (paginated, `?page=N`, 100 per page), `new` (25 newest), `collections`, `collection/{id}` (in the collection's manual order), `search?q=` (via `search_library()`), `opensearch.xml`, `download/{assetId}` and `cover/{assetId}`. Records with no primary asset are omitted; entries carry cover images when a cover asset exists. E-readers cannot send a Supabase JWT, so the function does its own auth (`auth: 'none'`, `verify_jwt = false` in `config.toml`, `--no-verify-jwt` when deploying to a hosted project): HTTP Basic with the account email and password, exchanged for a session on the request-scoped client. Every query then runs as that user under RLS; no service-role client is used. Accounts that only use magic-link sign-in have no password and cannot use the feed. Files stay private (invariant 7): file and cover links re-authenticate and redirect to a fresh 300 s signed URL. Links are built from `SUPABASE_PUBLIC_URL`.

### 8.6 `delete-account`

`POST { confirm: 'DELETE' }` → `{ status: 'deleted', objectsRemoved }`. The signed-in user deletes their own account and library (`user` auth; a caller can only ever delete themselves). `auth.admin.deleteUser()` cascades every table (all `user_id` foreign keys are `ON DELETE CASCADE`), then the function removes the user's `${userId}/` prefix in `documents`, `covers` and `staging`. If the storage step fails, the daily `cleanup` job removes the folder of a user that no longer exists (§15 #9). This is the second function, with `job-worker`, that uses the service role for something a user cannot do.

---

## 9. Key flows

### 9.1 Upload

```
Client                         upload fn (service role)              Storage / DB
  │ intent {uploadId, recordId, filename, size}
  ├──────────────────────────────►│ verify record ownership, size ≤ limit
  │                               │ createSignedUploadUrl(staging/{user}/{uploadId}/{filename})
  │◄──────────────────────────────┤ {path, token}
  │ uploadToSignedUrl(path, token, file) ───────────────────────────► staging
  │ complete {uploadId, recordId, role}
  ├──────────────────────────────►│ download staging object
  │                               │ check size; detect type from magic bytes; SHA-256
  │                               │ copy → documents/{user}/{sha256}.{ext}   (idempotent)
  │                               │ INSERT asset ON CONFLICT (user_id, checksum) → existing
  │                               │ INSERT record_assets ON CONFLICT DO NOTHING
  │                               │ INSERT jobs (idempotency_key = '{type}:{asset_id}')
  │                               │ delete staging object
  │◄──────────────────────────────┤ created | deduplicated | rejected
```

Properties:
- **Idempotent:** same `uploadId` → same staging path; content-addressed destination; `ON CONFLICT` on asset, link, and jobs. Retrying `complete` at any point is safe.
- **No dangling rows:** the file is copied to its final path *before* the asset row is inserted.
- **Orphans:** interrupted uploads leave only staging files, removed by `cleanup`.

### 9.2 Metadata lookup and apply

1. User enters an identifier; the SPA validates it with the shared module for instant feedback.
2. SPA calls `metadata-lookup`; shows a preview diff against current values.
3. User confirms per field. Locked fields (`records.metadata.locked_fields`) are shown but not applied.
4. Contributors: the SPA calls `contributor_candidates()` with the incoming match keys and scores them with `shared/names.ts` (§6.3). The preview shows each credit as *linked to X (reason)*, *new*, or *possibly X — review*, and the user can override any of them.
5. SPA writes the accepted values through supabase-js (RLS applies), setting `metadata_source` and `metadata_fetched_at`. It creates any new contributors, then saves the credit list with `set_record_contributors()`.

### 9.3 Reading

1. SPA picks the asset (the one in `reading_states.asset_id`, else the primary), requests a 5-minute signed URL, and loads it into pdf.js / epub.js.
2. Progress is saved (debounced, ~5 s) with an upsert on `reading_states (user_id, record_id)`.
3. Annotations are stored against the exact `asset_id` they were made on.

---

## 10. External metadata providers

Called only from Edge Functions. Allowlisted hosts: `openlibrary.org`, `covers.openlibrary.org`, `api.crossref.org`, `export.arxiv.org`, `api.semanticscholar.org`, `www.googleapis.com`, `archive.org`, `api.firecrawl.dev`; catalogue results are restricted to official HTTPS product pages at `www.iso.org`, `webstore.iec.ch`, `store.astm.org`, `www.asme.org` and `knowledge.bsigroup.com`; Open Library cover redirects are additionally restricted to `archive.org` and `*.us.archive.org`.

| Scheme | Provider order |
|--------|---------------|
| `isbn` | Open Library → Google Books → Internet Archive (when neither earlier source finds metadata) |
| `doi` | Crossref → Semantic Scholar (`DOI:{doi}`) |
| `arxiv` | arXiv API → Semantic Scholar (`ARXIV:{id}`) |
| `pmid` | Semantic Scholar (`PMID:{id}`) |
| `issn` | Crossref journals (`/journals/{issn}`) |
| `iso`, `iec`, `astm`, `asme`, `bs` | Official ISO, IEC Webstore, ASTM Store, ASME or BSI Knowledge catalogue, discovered and read through Firecrawl |

| Provider | Endpoint | Auth | Etiquette / limits (verify before release) |
|----------|----------|------|-------------------------------------------|
| Open Library | `https://openlibrary.org/isbn/{isbn}.json` | None | Descriptive `User-Agent` with contact |
| Crossref | `https://api.crossref.org/works/{doi}`, `/journals/{issn}` | None | Polite pool: `mailto` from `CROSSREF_MAILTO` |
| arXiv | `https://export.arxiv.org/api/query?id_list={id}` (Atom XML) | None | ≤ 1 request / 3 s |
| Semantic Scholar | `https://api.semanticscholar.org/graph/v1/paper/{id}` | Optional `x-api-key` | Unauthenticated calls share a global pool and may be throttled |
| Google Books | `https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn}` | API key (effectively required) | The unauthenticated shared quota was exhausted when checked; skip this provider when no key is configured |
| Internet Archive | `https://archive.org/advancedsearch.php?q=isbn:{isbn} AND mediatype:texts&output=json` | None | Exact ISBN search, one result; search dates retain year precision because the index expands year-only dates |
| Official standards catalogues through Firecrawl | `https://api.firecrawl.dev/v2/search`, `/scrape` | Server-only `FIRECRAWL_API_KEY` | Search one authority, inspect at most three official product pages, validate exact reference/year before accepting metadata; typed failures and 30-day success cache |

**Contributor data per provider** (checked against live responses):

| Provider | Names | Roles | IDs |
|----------|-------|-------|-----|
| Crossref | Structured `given`/`family`; `name` for organizations | Separate `author` and `editor` arrays, plus `sequence` (first/additional). Edited books are registered chapter by chapter with chapter authors | ORCID, `affiliation` |
| Open Library | `authors` are keys (`/authors/OL…A`); names need a second fetch | None in `authors`. Editors often appear there anyway; the role is only in free-text `by_statement` (`… ed`) | Open Library author key |
| arXiv | Name strings (parse) | Authors only | — |
| Semantic Scholar | Name strings (parse) | Authors only | S2 author ID |
| Google Books | Name strings (parse) | None — editors appear as authors | — |
| Internet Archive | `creator` strings (parse); may be absent | No structured roles; review editor warnings | — |

When sources disagree on roles, Crossref wins. A provider listing people as authors on a record whose title or `by_statement` says "edited" is shown as a role warning in the preview.

Bibliographic provider parsers live in `supabase/functions/metadata-lookup/index.ts`, with official standards catalogue lookup in `standards.ts`; mocked-response tests cover each provider. Shared identifier validation lives in `supabase/functions/_shared/identifier.ts` and is re-exported to the SPA from `shared/identifier.ts`.

---

## 11. TypeScript types

**Database row types are generated**, never hand-written:

```bash
npx supabase gen types typescript --local > src/types/database.ts
```

```typescript
// src/types/index.ts
import type { Database } from './database';

type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

export type WorkRow = Tables<'works'>;
export type RecordRow = Tables<'records'>;   // avoids clashing with TS's Record<K, V>
export type IdentifierRow = Tables<'identifiers'>;
export type ContributorRow = Tables<'contributors'>;
export type CreditRow = Tables<'record_contributors'>;
export type AssetRow = Tables<'assets'>;
export type ReadingStateRow = Tables<'reading_states'>;
export type AnnotationRow = Tables<'annotations'>;

export type IdentifierScheme = 'isbn' | 'doi' | 'issn' | 'arxiv' | 'pmid' | 'iso' | 'iec' | 'astm' | 'asme' | 'bs';
export type WorkType = 'book' | 'article' | 'serial' | 'thesis' | 'report' | 'standard' | 'other';
export type FileFormat = 'pdf' | 'epub' | 'mobi' | 'azw3' | 'cbz' | 'html' | 'txt' | 'image';
export type ReadingStatus = 'unread' | 'reading' | 'finished' | 'abandoned';
export type ContributorRole = CreditRow['role'];
```

Hand-written types exist only for things the database does not describe:

```typescript
export interface NormalizedMetadata {
    title: string;
    subtitle?: string;
    contributors: Array<{
        role: ContributorRole;
        position: number;                  // order within the role, from 0
        kind: 'person' | 'organization';
        family?: string;                   // structured when the provider gives it (Crossref)
        given?: string;
        particle?: string;
        suffix?: string;
        literal?: string;                  // unparsed name string or organization name
        identifiers?: Partial<Record<'orcid' | 'openlibrary' | 'semantic_scholar', string>>;
        affiliation?: string;
    }>;
    publication_date?: string;             // ISO 8601, truncated to precision
    publication_date_precision?: 'year' | 'month' | 'day';
    publisher?: string;
    container_title?: string | null;        // journal / proceedings, null when checked but unavailable
    edition?: string;
    standard_scheme?: 'iso' | 'iec' | 'astm' | 'asme' | 'bs';
    standard_reference?: string;            // transient response; saved in identifiers
    standard_status?: string;
    language?: string;                     // BCP 47
    abstract?: string;
    identifiers: Array<{ scheme: IdentifierScheme; value: string }>;
    cover_url?: string;
    source_provider: string;
    source_url?: string;
    work_type: WorkType;
    record_type?: RecordRow['record_type'];
    metadata?: Record<string, unknown>;    // volume, issue, pages, container title, …
}

export interface LibraryFilters {
    search: string;
    work_type: WorkType | null;
    tags: string[];
    collection_id: string | null;
    reading_status: ReadingStatus | null;
    format: FileFormat | null;
    language: string | null;
    sort_by: 'title' | 'author' | 'date_added' | 'date_published' | 'recently_read';
    sort_order: 'asc' | 'desc';
}
```

Each hand-written type that crosses a boundary has a matching Zod schema; derive the type with `z.infer` rather than declaring both.

---

## 12. Project structure

```
textus/
├── src/
│   ├── components/
│   │   ├── ui/               # shadcn/ui generated components
│   │   ├── library/          # DocumentGrid, RecordCard, FilterBar
│   │   ├── metadata/         # IdentifierInput, MetadataPreview, ContributorEditor
│   │   ├── contributors/     # ContributorPage, ContributorReviewQueue, MergeDialog
│   │   ├── reader/           # PdfViewer, EpubViewer, AnnotationPanel
│   │   └── layout/           # Header, Sidebar, TagBrowser
│   ├── hooks/                # useRecords, useMetadataLookup, useReadingState, useCollections
│   ├── lib/
│   │   ├── supabase.ts       # client (anon key only)
│   │   ├── functions.ts      # typed Edge Function invocations
│   │   └── export.ts         # annotation export (Markdown/JSON)
│   ├── pages/                # Dashboard, Library, RecordDetail, Contributors, Collections, Settings
│   ├── stores/               # Zustand stores (UI state only)
│   ├── types/
│   │   ├── database.ts       # GENERATED — do not edit
│   │   └── index.ts
│   ├── App.tsx
│   └── main.tsx
├── shared/
│   ├── identifier.ts         # identifier validation/normalization (SPA + Edge Functions)
│   └── names.ts              # splitNames, parseName, fold, compareGiven, scoring, formatByline (§6.3)
├── supabase/
│   ├── config.toml
│   ├── functions/
│   │   ├── _shared/          # cors, auth, zod schemas, providers/
│   │   ├── metadata-lookup/
│   │   ├── upload/
│   │   ├── job-worker/
│   │   └── export/
│   └── migrations/
├── tests/
│   ├── integration/          # Edge Functions against local Supabase, providers mocked
│   ├── e2e/                  # upload, lookup, read
│   └── fixtures/
└── public/
```

Unit and component tests are co-located (`Foo.test.tsx` next to `Foo.tsx`). `shared/*.ts` must be dependency-free TypeScript so both Vite and Deno can import it. `shared/names.ts` tests include the golden cases in §6.3.

---

## 13. Milestones

### M1 — Foundation
- [ ] Auth (email, magic link, OAuth) — FR-AUTH-1/2
- [x] Schema, RLS, storage migrations (§7)
- [x] Work / record / identifier CRUD — FR-CAT-1..5
- [x] Contributors: structured names, paste parsing, ordered credits with roles, editor fallback in bylines — FR-CONTRIB-1..4
- [x] Upload flow with verification and dedup — FR-FILE-1..6
- [x] Job worker with `extract_text` and `generate_thumbnail`
- [x] Basic PDF viewer — FR-READ-1
- [x] Search on title and contributor — FR-SRCH-1

### M2 — Metadata
- [x] ISBN (Open Library, Google Books), DOI (Crossref), arXiv, PMID, ISSN lookups — FR-META-1/6
- [x] Preview and per-field apply with locking — FR-META-2/3/4
- [x] Cache — FR-META-5
- [x] Cover retrieval (`process_cover`)
- [x] Contributor matching, variants, pseudonyms, external IDs — FR-CONTRIB-5/6
- [x] ISBN/DOI extraction from PDF/EPUB text and file names, with background metadata suggestions

### M3 — Organization
- [x] Tags and collections — FR-ORG-1/2
- [x] Filtering and sorting — FR-ORG-3
- [x] Bulk operations — FR-ORG-4
- [x] Saved searches — FR-ORG-5
- [x] Contributor merge/split, review queue, duplicate finder, contributor page — FR-CONTRIB-7..9

### M4 — Reading
- [x] EPUB viewer — FR-READ-2
- [x] Progress sync — FR-READ-3
- [x] Highlights and annotations, export — FR-READ-4/5 (EPUB: text highlights by CFI; PDF: page-anchored notes, since the canvas viewer has no text layer)
- [x] Download for non-viewable formats — FR-READ-6

### M5 — Export and serials
- [x] BibTeX / RIS / CSL-JSON — FR-RES-1
- [x] Preprint ↔ published linking — FR-RES-2 (two `article_version` records under one work, labelled by `records.metadata.version`)
- [x] CSV / DOI-list import — FR-RES-3
- [x] Serial issue tracking and completeness — FR-SER-1/2 (issues are expected to run 1..max within a volume; no per-serial expected counts)
- [x] Chapters / articles inside container records — FR-CONTRIB-10
- [x] OPDS feed — FR-SER-3

---

## 14. Deviations from the original definition

The source definition was adopted with these corrections. Each fixes an inconsistency or a bug in it.

| # | Change | Reason |
|---|--------|--------|
| 1 | Table count stated correctly: 18 (17 + `jobs`) | Source said 14 but defined 15; the contributor model (row 20) adds 3. |
| 2 | Dropped `uuid-ossp` and `pgcrypto`; added `pg_cron`, `pg_net` | `gen_random_uuid()` is core since PG 13. The queue needs a scheduler. |
| 3 | Policies use `(SELECT auth.uid())` and `TO authenticated` | Evaluated once per query instead of per row; anon never matches. |
| 4 | Record-scoped policies use `private.is_record_owner()` | Removes a dozen copies of the same join; avoids nested RLS cost. |
| 5 | Clients can only SELECT `assets`; no client INSERT on `record_assets` | Otherwise a client could create assets that bypass checksum/MIME verification, or edit `storage_path`, breaking immutability. |
| 6 | `assets_immutable` trigger | Enforces immutability for every role, including the service role. |
| 7 | `assets.bucket` column; `UNIQUE(user_id, checksum_sha256)` | Covers live in a different bucket from documents. The unique constraint gives dedup and upload idempotency without an upload-sessions table. |
| 8 | Added UPDATE policies on `record_contributors` and `collection_records` | `display_order` could not be changed otherwise. |
| 9 | Removed `collections.is_public` and public SELECT policies | Records RLS is owner-only, so public collections would appear empty. Public sharing is out of scope until designed end-to-end. |
| 10 | `jobs.user_id` column replaces `(payload->>'user_id')::UUID` in RLS | The cast errors on malformed payloads and cannot use an index. |
| 11 | Storage policies written out for every bucket; no client writes | Source left covers/staging as "similar policies…". Signed upload URLs make client write policies unnecessary. |
| 12 | DOIs normalized to lowercase | DOIs are case-insensitive; preserving case breaks dedup. `original_value` keeps the input. |
| 13 | Provider calls only in Edge Functions; removed `src/lib/api/*` provider clients | Source put provider clients in the SPA while also requiring keys to stay server-side. |
| 14 | `file-processor` replaced by `upload` + `job-worker` | Source had both a DB-trigger-invoked processor and a jobs table; one queue path is simpler and retryable. |
| 15 | Added providers for PMID (Semantic Scholar) and ISSN (Crossref journals); removed ISSN Portal | PMID/ISSN were accepted schemes without a provider; ISSN Portal's API is subscription-based. |
| 16 | arXiv endpoint uses HTTPS | Source used plain HTTP. |
| 17 | Row types generated with `supabase gen types`; `Record_` → `RecordRow` | Hand-written row types drift from the schema; `ReadingState` was referenced but never defined. |
| 18 | README deployment: CLI local stack for development, `db push --db-url`, `volumes/functions` for self-hosted functions, Vite env as build args | Source commands targeted the hosted platform or would not work (`VITE_*` is build-time). |
| 19 | Removed indexes duplicated by the leading column of a PK or UNIQUE constraint | e.g. `record_tags(record_id)`, `metadata_cache(scheme, value)`. |
| 20 | Contributor model redesigned (§6.3): removed `UNIQUE(user_id, name_normalized)`; added structured names, `contributor_names`, `contributor_identifiers`, `contributor_distinctions`; credits get `position`, `credited_as`, `affiliation`, `resolved_by`; roles extended | The unique name forced different people with the same name into one contributor (Calibre's flaw). There was no way to represent variants, pseudonyms, or editor-only books properly. |
| 21 | `records.container_record_id`; `chapter` work and record types | "Article-level records within issues" and chapters of edited volumes were required but could not be modeled. |
| 22 | ORCID moved from a `contributors` column to `contributor_identifiers` | One mechanism for all authority IDs, with uniqueness per library. |

---

## 15. Open questions and risks

| # | Topic | Detail | Proposed default |
|---|-------|--------|------------------|
| 1 | **Large files in Edge Functions** | The Edge runtime has memory and wall-clock limits. Hashing and parsing a 500 MB PDF in memory will fail. | Stream the SHA-256 (`@std/crypto` accepts async iterables). Lower the bucket limit to what the self-hosted runtime handles in testing. Revisit if large scans are common. |
| 2 | PDF text/thumbnail in Deno | `pdf-parse` is Node-oriented; rendering a page to an image in Deno is not trivial. | Evaluate `pdfjs-dist` in Deno for text; for thumbnails consider rendering in the browser on first open and uploading via the normal flow. |
| 3 | ~~Annotation / reading-state cross-ownership~~ | Resolved in migration `20260929000002`: INSERT and UPDATE policies on `reading_states` and `annotations` now require `private.is_record_owner(record_id)` and an owned `asset_id`. | Done. |
| 4 | Old-style arXiv IDs | `hep-th/9901001` format is not accepted. | Add when a user needs it. |
| 5 | Denormalized `records.user_id` | Every record-scoped check joins `works`. | Add only if RLS shows up in query plans at NFR-PERF-1 scale. |
| 6 | Search across contributors | FR-SRCH-1 needs names; `works.search_vector` does not include them. | A SQL function combining FTS on works/records with trigram on `contributors.display_name`, `contributor_names.name`, and `record_contributors.credited_as`. "Sort by author" uses primary creators (§6.3) computed in the same query; move to a trigger-maintained column only if it misses NFR-PERF-1. |
| 7 | Metadata locking model | `locked_fields` in `records.metadata` is the simplest option; works fields have no equivalent. | Store `locked_fields` for both levels in their `metadata` (add `metadata` to `works` if needed). |
| 8 | OPDS authentication | OPDS clients typically use HTTP Basic, not Supabase JWTs. | Decide in M5. |
| 9 | ~~Account deletion~~ | `ON DELETE CASCADE` removes rows but not storage objects. | Resolved: `delete-account` (§8.6) sweeps the user's storage immediately, and the `cleanup` job sweeps folders whose user no longer exists. |
| 10 | Contributor matching calibration | The score constants were validated on one 282-file collection. | Keep them in one constant block; revisit with review-queue accept/reject rates. |
| 11 | Large-collaboration papers | Papers with thousands of authors make `contributor_candidates()` arrays large and the credit list long. | Store all credits; the byline truncates. Cap evidence arrays if matching gets slow. |
| 12 | Name order and scripts | Spanish/Portuguese double surnames, East Asian names without separators, and nicknames parse wrongly. | Rely on structured provider data and the editable preview; add locale-aware rules only if users hit them. |
