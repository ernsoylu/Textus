# Textus roadmap

Updated 2026-10-01 against the M6 draft, existing investigations in §14–15, the FR/NFR requirements in
[ARCHITECTURE_AND_REQUIREMENTS.md](../ARCHITECTURE_AND_REQUIREMENTS.md), and the code.
M1–M5 are implemented except OAuth, which is deferred until release planning.
The original Figma inventory is retained in [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md);
a full reconciliation of those frames with the implementation remains open.

Status legend: **[ ]** open · **[x]** done

## Security and systemic review — 2026-10-01

Scope: repository documentation, migrations/RLS, authentication/cache, upload, worker/cleanup,
metadata, reader isolation, CI and the proposed AI/MCP flow. Existing uncommitted M6 design work
was preserved and amended. This is a source review with local reproductions and a dependency
audit, not a penetration test of app102/monster or verification of their deployed configuration.
Implementation is tracked by milestone in the log below; open gates remain explicit.

**P0** = fix current privacy/integrity weaknesses before widening access or enabling agent writes.
**P1** = high-priority prerequisite for the affected M6 feature or deployment.
Existing product polish follows these gates. Priority describes delivery order, not a CVSS rating.

### Current-code findings

| ID / priority | Evidence and impact | Planned fix and acceptance check |
|---|---|---|
| SEC-01 / **P0** | [AuthProvider](../src/hooks/useAuth.tsx), [QueryClient](../src/lib/queryClient.ts) and owner-independent keys such as `['contributors']` retain data across sign-out/account changes. A local QueryClient reproduction returned A's fresh cached result without fetching B's data. RLS does not protect browser caches. | Cancel requests and clear private query/mutation state at the central auth identity boundary; scope private keys to the owner and prevent late A responses repopulating B's state. Test A → sign-out → B without a reload, expired sessions, account deletion and an in-flight A request, including cached cover URLs/notes. |
| SEC-02 / **P0** | [`fetchPublic`](../supabase/functions/upload/index.ts) checks DNS, then `fetch` resolves again; the code explicitly acknowledges the rebinding window. M6's URL tool would inherit it. | Bind the connection to a validated public address while preserving TLS hostname verification, or use a verified egress restriction for arbitrary URL downloads; do not assume a custom resolver exists in the deployed Deno runtime. Recheck each redirect, bound DNS/whole-request time, reject all special-use IPv4/IPv6 destinations, and never forward credentials. If this cannot be enforced, disable arbitrary URL imports until it can. Tests must cover a public-to-private DNS change, redirects and internal/metadata endpoints. |
| SYS-01 / **P0** | [`completeStaged`](../supabase/functions/upload/index.ts) verifies one read and publishes a second; `from-url` can upsert that same staging key. It ignores link/job write errors, deletes staging, and returns success; a retry after success sees `missing`. This leaves integrity, lost-work and retry gaps despite FR-FILE-5. | Freeze an upload attempt before verification, publish exactly the verified bytes without overwriting an existing immutable object, and persist an owner-scoped completion result bound to the request. Atomically validate ownership and finalize asset/link/jobs; check every error. Retain recoverable state until completion and reconcile unregistered final objects. Test concurrent replacement/completion, changed request under the same ID, ownership changes, failed link/job writes and response-loss retries. |
| SYS-02 / **P0** | [Cleanup](../supabase/functions/job-worker/cleanup.ts) limits assets to 200 **before** filtering linked rows; a local fake-admin reproduction left orphan #201 untouched on repeated runs. Folder scans restart and stop at 50 users/1,000 entries; deletion checks links then removes bytes without coordinating with new links. §15 #9 was prematurely marked resolved. | Select only deletion candidates in SQL, paginate with durable bounded progress, and coordinate deletion claims with every asset-linking path. Keep retryable deletion state until storage removal succeeds. Test >200 linked assets ahead of an orphan, >50 active users ahead of a deleted user, >1,000 entries, concurrent relinking, storage failure and account deletion during a running job. A referenced asset must never lose its bytes. |
| SYS-03 / **P1** | [Worker](../supabase/functions/job-worker/index.ts) claims five jobs and executes them serially; later jobs consume attempts before starting. Final job writes ignore errors and are keyed only by ID. Failures do not consistently advance asset state. Upload fetches allow 300 s and [standards lookup](../supabase/functions/metadata-lookup/standards.ts) allows 70 s per call, versus the draft's reported 60 s runtime. | Use one end-to-end deadline per invocation and claim only work that can start within it. Fence completion/checkpoint writes by claim generation, check errors, atomically checkpoint/requeue bounded work and update processing states. Bound retries/backoff and per-user scheduling so indexing cannot starve uploads/cleanup. Test timeout between checkpoint and enqueue, stale workers, final-attempt crashes, deleted owners and long provider chains. |
| SEC-03 / **P1** | `npm audit --json` on the lockfile reports **1 critical, 1 high, 3 moderate affected packages**: Vitest 2.1.9, Vite 5.4.21 and their development dependencies. These are development-server/tooling findings, with platform/feature conditions; `npm audit --omit=dev` reports zero. This supersedes the old blanket clean-security claim below. | Upgrade the compatible Vite/Vitest/plugin set to patched releases and validate type-check, lint, unit tests, build and browser flows. Audit again after lockfile changes; do not blindly force major upgrades. Add a secret-free dependency check for fork PRs, inspect Deno and vendored readers separately, and actually run Edge unit tests in CI (currently only check/lint plus HTTP integration). Record the audit date and scope. |
| SYS-04 / **P1** | [`importMetadata`](../src/lib/autoMetadataImport.ts) picks the first `lookup_suggestions` entry containing a title and automatically applies it. M6 proposes adding `llm:<model>` to that same map; without a change this can bypass FR-AI-3's mandatory review and metadata precedence. [CSV/DOI creation](../src/hooks/useImport.ts) also performs separate writes without rollback. | Explicitly classify provenance and exclude LLM suggestions from automatic apply; preserve locks and require reviewed fields. Define bounded title/author provider search, which the identifier-only endpoint does not currently offer. Obtain consent before sending file-derived title/author text to external providers. Make catalog creation atomic/idempotent before reusing it for MCP. Test an LLM suggestion inserted first, manual locks, concurrent suggestions and a failure halfway through creation. |
| SEC-04 / **P1 validation gate** | [Reader CSP insertion](../src/lib/inertBookHtml.ts) uses string replacement; tests check strings/XHTML parsing, not hostile books executing in a browser. Missing-header fallback restricts scripts but not all remote resources/forms. No reader exploit was demonstrated in this review. | Add malicious EPUB/MOBI/SVG fixtures covering malformed/commented heads, nested frames, inline/external scripts, event handlers, forms, navigation and remote tracking. Verify both deployed CSP and missing-header behavior in supported browsers; harden insertion/resource restrictions where failures occur, while preserving CFI locations. Also verify signed HTML/TXT downloads cannot execute as the app origin. |

### M6 design gaps and required gates

| ID / priority | Gap | Planned fix and acceptance check |
|---|---|---|
| M6-SEC-01 / **P1** | A freshly minted `authenticated` JWT gives owner-level database capabilities; RLS isolates owners but does not implement `read` scope. The draft omits transport Origin checks, a callable path to the private token RPC, revocation semantics and signing-key rotation. | Enforce scope in one tool dispatcher; keep the internal JWT server-only, never return/log it or accept it as an agent token. Check token expiry/revocation and live owner on every request; no positive auth cache in v1. Keep private schema unexposed; use a narrow service-role-only wrapper for token verification with explicit grants and fixed `search_path`. Validate Origin, protocol/content types and body limits through the gateway. Default to read tokens, document expiry/rotation and test two users, direct write attempts, expired/revoked tokens, invalid Origin and signing-key rollover. |
| M6-SEC-02 / **P1** | Prompt delimiters, quote matching and a Hermes instruction are not an authorization boundary. A malicious passage can still influence the agent's later tool calls. | Treat all book/provider/model content as untrusted data. Models may select only retrieved passage IDs/quotes; resolve citations and links server-side. Start Hermes read-only. For writes, bind an explicit owner approval to the concrete action/arguments and make execution single-use/idempotent; a tool argument saying `confirmed: true` is insufficient. Never automatically open/download passage URLs. Test a book asking the agent to import a URL, modify tags or reveal tokens; none may execute without authorization. |
| M6-SEC-03 / **P1** | The draft accepts unauthenticated Ollama on the LAN and exposes every installed generation model. There are no request/queue/index quotas. A valid user can monopolize a 4 GB GPU, queue or storage. | Restrict Ollama ingress to named trusted callers now, even on the LAN; add an authenticated proxy when the segment is not isolated. Allow only admin-approved local models, disable cloud use, reject redirects and expose no model pull/delete/proxy tools. Bound request/response bytes, questions/work-ID arrays, per-user/token rates, index/storage totals and instance-wide GPU concurrency across workers. Return `429`/retry guidance. Test oversize payloads, concurrent callers, prohibited models, AI disabled/unreachable and that normal catalog/cleanup work still proceeds. |
| M6-SYS-01 / **P1** | A 25 MB compressed-file cap and per-page batches do not by themselves bound PDF decode/EPUB inflation. The existing extractors cover eight PDF pages/eight HTML entries; ZIP order is not EPUB reading order. The passage sketch has no index generation or backfill/cancellation contract. | Implement bounded PDF range loading and EPUB spine-order extraction with measured memory/time, cumulative decompression limits and stable locations. Enforce passage owner = asset owner in the database; only active, owned record links may produce citations. Version extraction/chunking and embedding model digest/dimension; resume deterministic batches, remove stale generations and never mix vectors. Backfill existing assets, support retry/cancel/reindex, and distinguish partial/unsupported/encrypted/no-text states. Test crash/resume, shared assets, unlink/delete during work, changed model and one successful reader deep link per format. |
| M6-SYS-02 / **P1** | Twenty ~500-token candidates can exceed an 8k context before the question/output; the suggested dual-model residency is unproven on the stated GPU. `workIds` has no SQL parameter, HNSW filtering can underfill tenant results, and an empty retrieval is incorrectly equated with no knowledge in the library. | Apply owner/work filters in retrieval; bound prompts by the selected model's actual context and output budget. Benchmark warm/cold/swap/concurrent calls on monster; tune batch/concurrency/context before changing runtime limits. Benchmark passage counts as well as record counts, and compare tenant-filtered HNSW recall with exact search. Return indexed coverage, partial state and an explicit FTS fallback when AI is unavailable. Report “no supporting passage found in indexed text,” not that the library cannot cover a question. Test relevant text beyond page 8, negative questions, non-English text, work filters, citation fidelity and fallback. |
| OPS-01 / **P1** | Deployment notes disagree (old app02 HTTP vs draft app102 HTTPS); SMTP/export/OPDS verification is still open. Backup instructions do not demonstrate a consistent restore. Tokens/indexes add secrets, sensitive derived data and rebuild costs. | Inventory actual routes/versions/limits first; verify HTTPS, gateway auth/CORS, private buckets, signup policy, SMTP/recovery and OPDS rate limits. Back up DB + object metadata/bytes + configuration consistently and restore to an isolated instance; verify documents, covers, notes and derived-index rebuilds. Redact tokens, signed URLs, book text and questions from logs; bound job/log retention and record token/tool/outcome IDs for diagnosis. Invalidate restored agent tokens by default. Deploy migrations → functions → frontend with AI/MCP off, smoke-test, then enable in stages with a documented disable/rollback path. |

### Revised M6 build order

| Phase | Deliverable | Exit gate |
|---|---|---|
| **M6.0 — security and integrity first** | [x] SEC-01/02/03 and SYS-01/02/03; deployment inventory and resource limits. | Privacy, SSRF, upload replay and deletion-race checks pass; dependency findings triaged/patched; actual runtime limits documented. |
| **M6.1 — safe optional AI foundation** | [ ] Activity count and truthful processing state (FR-FILE-6), AI settings/status, local model allowlist, network/rate/concurrency controls (FR-AI-1/2). | M6-SEC-03; catalog stays usable with AI disabled/unreachable; existing queued AI jobs pause/skip without burning retries. |
| **M6.2 — complete, resumable FTS passages** | [ ] Versioned PDF/EPUB indexing, backfill, coverage/progress, FTS search and reader links (FR-AI-4). | M6-SYS-01; bounded memory/time, two-user isolation and resume/delete fixtures pass. FTS works without Ollama. |
| **M6.3 — reviewed metadata fallback** | [ ] AI front-matter suggestions and bounded provider fallback (FR-AI-3). | SYS-04; user review/locks/provenance and external-disclosure consent verified. |
| **M6.4 — read-only agent access** | [ ] Token settings, MCP read tools and Hermes skill (FR-AI-6/7/8). | M6-SEC-01/02; actual Hermes/gateway interoperability, revocation, Origin and cross-user tests pass. `find_sources` advertises unavailable until M6.5. |
| **M6.5 — hybrid retrieval and cited sources** | [ ] Embedding batches, hybrid ranking and source selection (FR-AI-4/5). | M6-SYS-02; relevance/citation fixtures, measured GPU budgets and FTS degradation pass. |
| **M6.6 — authorized, retry-safe writes** | [ ] Identifier creation, URL import, tags and collections (FR-AI-7). | Shared atomic creation/upload paths, server-checked owner approval, scope enforcement, quotas and replay tests pass. |
| **M6.7 — deployment sign-off** | [ ] OPS-01 restore/rollback drill, reader security fixtures, accessibility/device tests and staged enablement. | SEC-04 and all P0/P1 checks above pass on the target deployment; no inherited “done” claim substitutes for evidence. |

Validation performed for this review: full and production-only npm audits; isolated QueryClient
and cleanup reproductions against installed/source code. The existing integration/browser suite
and live servers were not exercised. New regression tests listed above belong with the fixes.

Primary references: the [Vitest advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp)
requires the vulnerable UI server to be listening; the [high Vite advisory](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)
concerns Windows development-server paths. [MCP transport rules](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
require Origin validation; pin and test the protocol version supported by the installed Hermes/SDK.
[OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
supports layered URL/redirect/network defenses. [pgvector filtering guidance](https://github.com/pgvector/pgvector#filtering)
explains approximate-index underfilling; [Ollama deployment guidance](https://docs.ollama.com/faq)
documents network binding and concurrency controls.

## Implemented

- [x] Email/password, magic links, password recovery, sign-out, unsaved-change dialogs, appearance settings and account deletion with storage cleanup.
- [x] Overview, background-job Activity, global search (⌘K), Add to library, secondary pages in mobile More, 404/offline/empty/loading states.
- [x] Work/record editors specialize fields by type and preserve hidden fields and manual metadata locks. Journal metadata and edition-specific ISO/IEC/ASTM/ASME/BS reference lookup are supported.
- [x] Upload progress, drag-and-drop, retry/rejection, format detection, checksum deduplication, file removal and private covers.
- [x] Library covers expose Read, View details and half-star book ratings on hover, focus and touch. Ratings persist from 0.5 to 5 and can be cleared in the work editor.
- [x] Server-side filtered/paged library queries, cover ribbons and keyboard navigation in search; partial Unicode and accent-insensitive metadata matches alongside contributor fuzzy search and PDF/EPUB file-text FTS.
- [x] Automatic tag colors, tag detail/edit flows, tags on records/collections/notes, ordered collections, bulk actions and saved searches.
- [x] Contributor matching/review, duplicate finder, merge/split, variants, authority IDs and contributor pages.
- [x] PDF reader uses pdf.js viewer components for continuous scrolling, fit modes, zoom, spreads, outline, page labels and text search.
- [x] EPUB/MOBI/AZW3/CBZ reading uses foliate-js; reflowable books have paginated/scrolling layouts, columns, contents, search, position slider, text size, line spacing and themes. Unsupported/DRM-protected files remain downloadable.
- [x] DjVu reading uses vendored DjVu.js, with page navigation, fit/zoom, contents and OCR text selection where text exists. Scans without text support page notes.
- [x] Fullscreen (F), keyboard navigation, device-local reader preferences, cross-device reading progress/status and asset-specific resume positions.
- [x] Selection-based highlights, right-click comments, in-text comment markers, editable/tagged notes, book grouping, text/tag/color/comment filters, reader deep links and Markdown/JSON export.
- [x] BibTeX/RIS/CSL-JSON export, CSV column mapping/review, DOI import, preprint/published links, serial issue editing and expected-issue ranges, container records and authenticated OPDS.
- [x] Streaming upload verification/copy and daily cleanup. Background PDF/EPUB extraction stores capped text for search (100,000 indexed characters per asset).

## Remaining product and quality work

- [ ] OAuth (FR-AUTH-1), intentionally deferred.
- [ ] Change an existing file's attachment role; `record_assets` has no client UPDATE policy.
- [ ] Edit a contributor's primary name and authority IDs directly from contributor detail.
- [ ] Replace the deliberately simple contributor matching in NewWork if observed mismatches warrant it.
- [ ] Rename/update saved searches.
- [ ] Full manual screen-reader and device testing, including the rebuilt readers and annotation menus. Existing axe scans cover Library, work metadata and PDF reader flows, not every format/state.
- [ ] Reader regression fixtures for EPUB/MOBI/AZW3/CBZ/DjVu, including OCR-less scans, malformed files and existing EPUB CFIs.
- [ ] Repeat the 10,000-record search benchmark after the Unicode substring-search migration. The earlier local warm-cache PostgreSQL p95 was 11.56 ms for listing and 94.56 ms for search; it predates migration `20260930000004` and excludes network/cold-cache latency. Use `supabase/tests/database/library_perf.sql`.
- [ ] Measure large-file background extraction; upload streaming is implemented, but PDF/EPUB parsing still reads the file into memory (§15 #1).
- [ ] Reconcile remaining Figma states with the implemented frontend.
- [ ] Review nonblocking SonarCloud maintainability findings (including complexity, JSX spacing and repeated SQL literals) as the affected code changes. The earlier quality gate passed; current security priorities are tracked above and require fresh validation.

## Review and CI

- [x] [PR #1](https://github.com/ernsoylu/Textus/pull/1): frontend, database migration/RLS/HTTP integration, Edge Function checks, Snyk workflow and Snyk PR security check pass.
- [x] Historical SonarCloud quality gate passed with A reliability/security/maintainability ratings. This is not a current security clearance; see SEC-03 above. Generated database types and upstream DjVu code are excluded from source analysis; immutable migrations are excluded only from duplication detection, retaining SQL issue analysis.
- [x] Vitest uses test-only API credentials rather than a developer's local environment and native abort signals compatible with Node's Request. CI/Docker builds use Node.js 24 (pdf.js requires 22.13+). Local validation: 152 unit/component tests and 13 Playwright flows, including reader focus/navigation and axe scans.

## Operations requiring deployment verification

The following are carried forward from the 2026-09-29 deployment notes; this review did not recheck app02/app102. The M6 draft reports HTTPS routes, so reconcile these notes against deployment evidence under OPS-01:

- [ ] Configure working SMTP for magic-link and recovery emails.
- [ ] Provide a public HTTPS route; the recorded app URL is `http://192.168.1.102:8080`.
- [ ] Verify export and OPDS on app02; local integration tests pass.
- [ ] Apply the latest ordered migrations and deploy/rebuild the updated functions/frontend on app02, then smoke-test standards lookup, all reader formats, annotations/tags and ratings.

## M6 implementation log

- [x] **M6.0 — 12.5%**: identity-isolated caches/UI, address-pinned URL downloads, immutable frozen uploads with transactional/replayable completion, deletion claims with progressive SQL selection/retry backoff, one-job claims with generation-fenced completion and bounded provider deadlines. Vite/Vitest/plugin updates audit clean; Edge tests and secret-free npm audit run in CI. Target inventory confirms app102 PostgreSQL 17.6 and 150 MB/60 s Edge settings; monster Ollama 0.32.4 and GTX 1050 Ti 4 GB. Validation: 162 frontend tests, 13 browser flows, six Edge unit tests, 12 integrity assertions, existing RLS isolation assertions and local gateway upload/export/OPDS integration. New migrations are applied to the local test database; production deployment follows M6.7.
