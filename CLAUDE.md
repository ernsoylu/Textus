# CLAUDE.md — Textus

Textus is a self-hosted library manager for books, research papers, and magazines: a React/TypeScript SPA on Supabase (PostgreSQL + RLS, Auth, Storage, Edge Functions). License AGPL-3.0.

**Source of truth:** [ARCHITECTURE_AND_REQUIREMENTS.md](ARCHITECTURE_AND_REQUIREMENTS.md) — requirements (FR/NFR IDs), full schema and RLS, Edge Function contracts, flows, milestones. Read the relevant section before changing the schema, RLS, storage, or a function contract, and update it in the same change when you alter any of them.

**Status:** M1 (§13) is complete except OAuth, intentionally deferred while Textus is in-house; use Supabase email/password + magic-link auth until release planning. Do not build OAuth UI or uncomment `GOTRUE_EXTERNAL_*` unless the user raises it. M2 metadata is implemented: provider lookup/cache, preview/apply with locks, contributor matching and authority IDs, PDF/EPUB identifier extraction, background suggestions, and private cover retrieval. `upload`, `metadata-lookup`, and `job-worker` Edge Functions are deployed and live-tested; `job-worker` runs from pg_cron every minute (§7.5). Semantic Scholar unauthenticated PMID calls may rate-limit without its optional API key. `generate_thumbnail` remains client-side on first PDF read (`src/components/reader/PdfViewer.tsx`) per §15 question 2. The contributor review queue and merge/split UI are M3; `export` is M5.

## Commands

```bash
npm run dev                  # Vite dev server (http://localhost:5173)
npm run build
npm run test                 # Vitest
npm run lint
npm run type-check
npx supabase start           # local Supabase stack
npx supabase functions serve # Edge Functions locally
npx supabase migration new <name>
npx supabase db reset        # rebuild local DB from migrations (local only)
npm run gen:types            # regenerate src/types/database.ts after any migration
```

## Fixed stack — do not propose alternatives

React 18 + Vite SPA · TypeScript strict · Tailwind + shadcn/ui · TanStack Query v5 (server state) · Zustand (UI state only) · Supabase (Postgres 15+, Auth, Storage, Edge Functions on Deno) · Zod · Vitest + Testing Library · pdf.js · epub.js.

Not allowed: Next.js/Remix, any separate backend service or language, direct S3 SDKs, Redis/RabbitMQ/external queues (the `jobs` table is the queue), ORMs (Prisma, Drizzle, …).

## Invariants

1. **Work → Record → Asset.** A work is intellectual content, a record is a manifestation (edition, article version, issue), an asset is immutable file bytes. Never conflate them: a PDF is an asset linked to a record, not a book.
2. **Identifiers live in the `identifiers` table**, validated and normalized by `shared/identifier.ts` (re-exporting the Edge-safe implementation in `supabase/functions/_shared/identifier.ts`, §6.2). Never store them in JSONB. DOIs are normalized to lowercase. File-derived identifier suggestions in asset metadata are unconfirmed and are not catalog identifiers.
3. **Assets are immutable and server-created.** Clients can only SELECT `assets`. A changed or converted file is a new asset linked with a new role. A DB trigger rejects changes to bytes-describing columns.
4. **RLS on every table.** Each operation has either a policy or a deliberate, commented absence (service-role only). Use `(SELECT auth.uid())` and `TO authenticated`. Record-scoped tables use `private.is_record_owner(record_id)`; junction inserts check ownership of *both* sides.
5. **No placeholder data.** Metadata lookups return parsed real data or a typed error: `not_found`, `invalid_identifier`, `rate_limited`, `provider_error`. Scheme switches are exhaustive.
6. **Uploads follow §9.1:** signed upload URL to `staging/` → `upload/complete` verifies size, sniffs type from bytes, hashes → content-addressed copy to `documents/` → asset `ON CONFLICT` → link → enqueue jobs. Never trust client MIME types. Keep every step idempotent.
7. **All buckets are private.** Read files through `createSignedUrl(path, 300)`. Never `getPublicUrl`.
8. **Contributors are identities, not name strings** (§6.3). Never add a uniqueness constraint on names, and never auto-merge on name alone. Save credits with `set_record_contributors()`; merge and split only through `merge_contributors()` / `reassign_credits()`. Name parsing, folding, matching, and bylines live in `shared/names.ts`. When a record has no authors, bylines and sorting fall back to editors, then compilers, then translators. Container editors are never copied onto chapters.
9. **Secrets stay server-side.** The SPA only has the anon key. Service role and provider keys exist only in Edge Functions. External providers are called only from Edge Functions.

## Conventions

- TypeScript strict, no `any` (use `unknown` and narrow). Validate every trust boundary with Zod; derive types with `z.infer`.
- DB row types are generated into `src/types/database.ts` — never edit it or hand-write row interfaces. Aliases (`WorkRow`, `RecordRow`, …) live in `src/types/index.ts`.
- Naming: tables snake_case plural; types/components PascalCase; functions camelCase; constants SCREAMING_SNAKE_CASE.
- One component per file. Tests co-located (`Foo.test.tsx`); integration/E2E in `tests/`; fixtures in `tests/fixtures/`.
- SQL: explicit column lists (no `SELECT *`); functions get `SET search_path = ''`; never edit an applied migration — add a new one.
- Edge Functions: CORS headers on every response (including errors and `OPTIONS`), `URL`/`URLSearchParams` for URLs, `AbortSignal.timeout` on every fetch, response size caps, host allowlist. Shared code in `supabase/functions/_shared/`.
- Errors: user-friendly messages in the UI; technical detail logged server-side only.
- Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).

## Testing expectations

- Unit tests for utilities — especially identifier validation (valid/invalid check digits, every accepted input form) and `shared/names.ts` (the golden cases in §6.3 must all pass).
- Integration tests for Edge Functions against the local stack with providers mocked from recorded fixtures.
- RLS tests: for each new table/policy, prove a second user can neither read nor write the first user's rows.
- Component tests for interactive UI; E2E for upload, lookup, and read.

## Before implementing a task

Check which milestone and FR IDs it covers, whether it needs a migration (then regenerate types), whether it touches RLS, storage, or external providers (security review), and whether it resolves or affects an item in §15 (open questions). If a task conflicts with the spec, say so instead of silently diverging.
