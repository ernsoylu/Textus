# Textus roadmap

Updated 2026-09-30 against the latest reader and library commits, the FR/NFR requirements in
[ARCHITECTURE_AND_REQUIREMENTS.md](../ARCHITECTURE_AND_REQUIREMENTS.md), and the code.
M1–M5 are implemented except OAuth, which is deferred until release planning.
The original Figma inventory is retained in [FRONTEND_DESIGN.md](FRONTEND_DESIGN.md);
a full reconciliation of those frames with the implementation remains open.

Status legend: **[ ]** open · **[x]** done

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
- [ ] Review nonblocking SonarCloud maintainability findings (including complexity, JSX spacing and repeated SQL literals) as the affected code changes. The quality gate passes; no open PR bugs or vulnerabilities remain from the failed gate.

## Review and CI

- [x] [PR #1](https://github.com/ernsoylu/Textus/pull/1): frontend, database migration/RLS/HTTP integration, Edge Function checks, Snyk workflow and Snyk PR security check pass.
- [x] SonarCloud quality gate passes with A reliability/security/maintainability ratings. Generated database types and upstream DjVu code are excluded from source analysis; immutable migrations are excluded only from duplication detection, retaining SQL issue analysis.
- [x] Vitest uses test-only API credentials rather than a developer's local environment and native abort signals compatible with Node's Request. CI/Docker builds use Node.js 24 (pdf.js requires 22.13+). Local validation: 152 unit/component tests and 13 Playwright flows, including reader focus/navigation and axe scans.

## Operations requiring deployment verification

The following are carried forward from the 2026-09-29 deployment notes; this branch review did not recheck app02:

- [ ] Configure working SMTP for magic-link and recovery emails.
- [ ] Provide a public HTTPS route; the recorded app URL is `http://192.168.1.102:8080`.
- [ ] Verify export and OPDS on app02; local integration tests pass.
- [ ] Apply the latest ordered migrations and deploy/rebuild the updated functions/frontend on app02, then smoke-test standards lookup, all reader formats, annotations/tags and ratings.
