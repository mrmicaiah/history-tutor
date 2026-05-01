# Stage 1 — Notes

## What was built

The repo is now a deployable, type-checking, empty-but-real skeleton. Every
acceptance criterion from the Stage 1 prompt passes locally:

- Repo layout matches Section 1 of the prompt exactly (with one addition; see
  *Deviations* below).
- `package.json` has the required scripts and the four required dev deps
  (typescript, @cloudflare/workers-types, wrangler, vitest, plus
  @vitest/coverage-v8).
- `wrangler.toml` declares the Worker and the `DB` D1 binding. The
  `database_id` field is a `REPLACE_WITH_ACTUAL_ID` placeholder with a
  comment block above it pointing at the three setup commands the operator
  must run before the first deploy.
- `worker/migrations/0001_initial.sql` creates all six tables
  (`conversations`, `turns`, `conversation_summary`, `knowledge_map`,
  `reference_cards`, `rate_limit`), the two indexes
  (`idx_turns_conversation_recent`, `idx_reference_cards_weak_first`), and
  seeds the single `conversations` row at `id = 1` via `INSERT OR IGNORE`.
- `worker/src/index.ts` exports a `fetch` handler that:
  - Returns `200 {"ok":true,"version":"stage-1","db":"connected"}` for
    `GET /api/health` (running `SELECT 1` against D1 to determine the `db`
    field; failures are logged server-side and surfaced as `"error"` only,
    never the exception text).
  - Returns `404 {"error":"not_found"}` for any other route.
- `worker/src/lib/responses.ts` has typed `json` and `errorResponse` helpers
  with permissive CORS (will tighten in Stage 2).
- `worker/src/env.ts` declares the `Env` interface with the `DB` binding and
  a forward-looking comment listing the Stage 2 secrets.
- TS configs: shared `tsconfig.base.json` with all eight required strict
  options (plus `isolatedModules`, `verbatimModuleSyntax`,
  `noFallthroughCasesInSwitch`, `resolveJsonModule`, `noEmit` — all
  uncontroversial defaults that prevent later footguns); `worker/tsconfig.json`
  pulls in `@cloudflare/workers-types`; `pages/tsconfig.json` adds the DOM
  lib.
- `vitest.config.ts` discovers tests under `worker/src/**/*.test.ts` and
  `pages/src/**/*.test.ts` in the node environment. No tests yet; the runner
  is verified to start cleanly.
- `pages/public/index.html` is a styled, responsive "under construction"
  placeholder so Pages has something to deploy.
- `.dev.vars.example`, `.gitignore`, and `README.md` all in place.

## Verified locally

| Check                                                           | Result |
| --------------------------------------------------------------- | :----: |
| `npm install`                                                   | ✓      |
| `npm run typecheck`                                             | ✓      |
| `npm run test`                                                  | ✓      |
| `npm run db:migrate:local` applies `0001_initial.sql`           | ✓      |
| All six tables + both indexes present in local D1               | ✓      |
| Seed row `conversations(id=1)` exists                           | ✓      |
| `wrangler dev` boots and `GET /api/health` returns the contract | ✓      |
| `GET /api/asdf` returns `404 {"error":"not_found"}`             | ✓      |
| CORS headers (`Access-Control-Allow-*`) present on responses    | ✓      |

## Decisions / deviations from the prompt

1. **`pages/src/index.ts` placeholder added.** The prompt says
   `pages/tsconfig.json` should include `src/**/*.ts` and that no `src/`
   exists yet. TypeScript errors out (TS18003 "no inputs were found") in
   that state, which would break `npm run typecheck`. I added a single
   one-line file (`export {};`) with a comment noting it is a placeholder
   until Stage 5. Smallest change that satisfies both the directory layout
   and the typecheck script.

2. **`vitest run` → `vitest run --passWithNoTests`.** Vitest exits 1 when
   no test files are found, which would also break the acceptance criterion
   that `npm run test` "runs (no tests, but the runner must work)". The flag
   makes it exit 0 in the empty-suite case; once real tests land it has no
   effect.

3. **Wrangler pinned to `^4.87.0`** (not the v3 line). The prompt asks for
   "latest stable as of build time". Wrangler 3 is still maintained but
   prints a per-run warning that today's compat date (`2026-04-30`) is newer
   than the runtime it bundles, falling back silently. v4 ships the matching
   runtime and runs warning-free.

4. **Extra `tsconfig.base.json` flags.** The prompt lists eight required
   compiler options; I added `isolatedModules`, `verbatimModuleSyntax`,
   `resolveJsonModule`, `noFallthroughCasesInSwitch`, and `noEmit`. Each is
   either required for Workers/Vitest compatibility or is a strictness
   tightening with zero downside at this stage. None of them weaken the
   prompt's requirements; happy to revert any if you prefer the exact list.

5. **Logging is `console.error` for now.** The project rules forbid
   `console.log` in production paths and call for a structured logger in
   Stage 2. The single `console.error('db_health_check_failed', err)` in
   `worker/src/index.ts` is marked with a `NOTE:` comment and will be
   migrated to the Stage 2 logger.

6. **Commented-out Stage 2 fields in `Env`.** The prompt explicitly tells me
   to "leave room for future bindings; comment that ANTHROPIC_API_KEY,
   PIN_HASH, and SESSION_SECRET will be added in Stage 2." I implemented
   that as a JSDoc note on the `Env` interface (no commented-out code in the
   body, just a documentation block) so the project rule "no commented-out
   code in commits" is honored.

## Manual checks the operator should run before Stage 2

1. **Create the production D1 database.** Run `wrangler d1 create
   history_tutor_db`, paste the printed `database_id` into `wrangler.toml`,
   and confirm `npm run db:migrate:remote` applies the migration cleanly.
   `wrangler deploy` will fail with a clear error until this is done.
2. **First deploy.** After step 1, run `npm run deploy` and curl
   `https://history-tutor.<your-subdomain>.workers.dev/api/health`. Expect
   `{"ok":true,"version":"stage-1","db":"connected"}`.
3. **Pages placeholder.** Either create a Pages project pointed at
   `pages/public/` from the dashboard, or run `wrangler pages deploy
   pages/public --project-name history-tutor`. Confirm the placeholder
   loads. Real frontend lands in Stage 5.

## Open questions

1. **D1 foreign-key enforcement.** D1 inherits SQLite's behavior: foreign
   keys declared via `REFERENCES` are *not* enforced unless `PRAGMA
   foreign_keys = ON;` is issued on the connection. There is currently
   nothing to enforce in Stage 1 (no relational writes from the Worker yet).
   In Stage 2, when the chat route starts inserting into `turns` and
   `reference_cards`, the Worker should issue the PRAGMA at the top of each
   request that touches related tables, or we should accept that we are
   relying on application-layer correctness only. Worth a 5-minute decision
   before Stage 2 starts.

2. **`compatibility_date = "2026-04-30"`.** I set it to today's date per the
   "current month or so" instruction. If you'd prefer a fixed pinned date
   that won't drift the next time someone updates the file, say the word
   and I'll lock it in.

3. **Pages deployment story.** Stage 1 only ships a static `index.html`. The
   prompt does not specify whether Pages should be configured via a
   `[pages]` section in `wrangler.toml`, a separate dashboard project, or
   the `wrangler pages deploy` CLI. I left Pages config out of
   `wrangler.toml` entirely (the file is Worker-only) and documented both
   CLI-deploy and dashboard paths in the README. Happy to wire it into
   `wrangler.toml` in Stage 5 once the real frontend exists and we know
   whether we want the Pages Functions integration.
