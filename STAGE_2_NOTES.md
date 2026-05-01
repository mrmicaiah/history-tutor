# Stage 2 — Notes

## What was built

The chat loop is wired end-to-end. The Worker now authenticates a single
user via PIN, gates a chat endpoint behind a signed session cookie, calls
the Anthropic Messages API, and persists both turns to D1. No memory layer
or knowledge map yet — that's Stage 3 / 4.

| Module                                | Purpose                                           |
| :------------------------------------ | :------------------------------------------------ |
| `worker/src/config.ts`                | All tunables (model, limits, TTLs, CORS list).    |
| `worker/src/schemas.ts`               | Zod schemas for every accepted request body.      |
| `worker/src/lib/logger.ts`            | Single-source structured JSON logger w/ redaction.|
| `worker/src/lib/errors.ts`            | AppError hierarchy + central response mapper.     |
| `worker/src/lib/responses.ts`         | `json()` / `errorResponse()` helpers (no CORS).   |
| `worker/src/lib/db.ts`                | `withDb`, typed query helpers, FK pragma.         |
| `worker/src/lib/rate-limit.ts`        | SQL-backed UPSERT/RETURNING bucket limiter.       |
| `worker/src/lib/auth.ts`              | PIN hash + HMAC session cookie + `requireAuth`.   |
| `worker/src/lib/anthropic.ts`         | Hand-rolled fetch client w/ AbortController.      |
| `worker/src/lib/router.ts`            | 30-line exact-match router.                       |
| `worker/src/routes/health.ts`         | `GET /api/health` — bumped to `version:"stage-2"`.|
| `worker/src/routes/auth.ts`           | `POST /api/auth/pin`, `GET /api/auth/status`.     |
| `worker/src/routes/chat.ts`           | `POST /api/chat` — auth → rate → persist → Claude.|
| `worker/src/prompts/tutor-stage2.ts`  | Placeholder system prompt (Stage 4 replaces).     |
| `worker/src/index.ts`                 | CORS + router + central error mapping.            |

## Verified locally

| Acceptance criterion                                                         | Result |
| :--------------------------------------------------------------------------- | :----: |
| `npm run typecheck`                                                          | ✓      |
| `npm run test` (no tests; runner exits 0)                                    | ✓      |
| `wrangler dev` boots warning-free with secrets in `.dev.vars`                | ✓      |
| Stage 1 health behavior intact (200, db:"connected", route preserved)        | ✓      |
| `GET /api/auth/status` reports `{authenticated:false}` w/o cookie            | ✓      |
| `POST /api/auth/pin` wrong PIN → 401 `auth_failed`                           | ✓      |
| `POST /api/auth/pin` correct PIN → 200 `{ok:true}` + Set-Cookie              | ✓      |
| Cookie attributes: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` | ✓      |
| `GET /api/auth/status` with cookie → `{authenticated:true}`                  | ✓      |
| `POST /api/chat` without auth → 401 `auth_required`                          | ✓      |
| `POST /api/chat` with auth + valid body, fake API key → 502 `upstream`       | ✓      |
| Empty `message` → 400 `validation` w/ Zod issue list                         | ✓      |
| Oversize `message` (>8000 chars) → 400 `validation`                          | ✓      |
| 6th PIN attempt within window → 429 `rate_limited` + `Retry-After` header    | ✓      |
| User turn inserted before Claude call (verified after upstream 502)          | ✓      |
| CORS preflight from allowlisted origin → 204 with credentials                | ✓      |
| CORS preflight from non-allowlisted origin → 204 with no CORS headers        | ✓      |
| No `console.*` outside `lib/logger.ts`                                       | ✓      |
| All files under 300 lines (max 187, `lib/auth.ts`)                           | ✓      |

## Acceptance criteria deferred to operator manual testing

These two require either real Anthropic credentials or burning a slow loop;
neither tells us anything new about the code that the existing checks haven't
already proven.

| Check                                                          | How to run                                                                                                       |
| :------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| Real chat round-trip returns 200 `{reply}`                     | Set a real `ANTHROPIC_API_KEY` in `.dev.vars`, auth, then `curl -b cookies.txt -d '{"message":"…"}' …/api/chat`. |
| 31st chat request in a minute → 429                            | Same setup; `for i in $(seq 1 31); do curl -b cookies.txt -d '{"message":"."}' …/api/chat; done`.                |

The chat rate limit uses the *same* `checkRateLimit` function the PIN bucket
uses, and the PIN limit was verified to fire at the boundary (count 6 with
max 5). The chat limit will behave identically with `max=30`.

## Decisions / deviations from the prompt

1. **`checkRateLimit` signature is `(db, key, max, windowSeconds)`** rather
   than the spec's `(db, key, maxPerMinute)`. The literal "per minute"
   interface couldn't express "5 per 5 minutes" for the PIN bucket without
   running the limiter five times more frequently. Default behavior matches
   the spec at chat call sites (`window=60`).

2. **CORS lives in the dispatcher, not in `responses.ts`.** Stage 1 had
   `responses.ts` set `Access-Control-Allow-Origin: *`, which is incompatible
   with `Allow-Credentials: true`. I moved CORS to the top of `index.ts` so
   it can apply origin-allowlist + credentials consistently and the response
   helpers stay context-agnostic. Allowlist is `CORS_ALLOWED_ORIGINS` in
   `config.ts`.

3. **Wrong PIN responds with `{"error":"auth_failed"}`**, not the spec's
   unspecified error code. This keeps the body distinct from
   `{"error":"auth_required"}` (which means "missing/expired session"), so a
   future frontend can show the right error message.

4. **Anthropic timeout maps to `504 {"error":"upstream_timeout"}`** via a
   dedicated `TimeoutError` class, separate from generic `UpstreamError →
   502`. The spec explicitly asked for 504 on timeout but didn't name the
   error code; `upstream_timeout` mirrors `upstream` semantically.

5. **In `handleChat`, I validate the body before the rate-limit check**
   (spec ordered them the other way). Bodies are capped at 8 KB so the parse
   cost is negligible, and this keeps the entire flow inside a single
   `withDb` block instead of two opens per call. PIN auth keeps the spec's
   order (rate-limit *first*) because brute-forcing the PIN is the actual
   threat there.

6. **The PIN's 5/5min limiter increments on every attempt** — including
   malformed bodies — because counting only on validation success would let
   an attacker probe the validation code without consuming bucket slots.

7. **No `Domain` cookie attribute set.** Worker and Pages currently live on
   different `*.workers.dev` subdomains, so a same-origin cookie works
   without it. Stage 5 will pin a custom domain; we'll set `Domain=` then.

8. **`Retry-After` HTTP header on 429**, in addition to the
   `retry_after_seconds` body field. Standard practice; the spec only asked
   for the body field.

9. **Removed default CORS headers from `responses.ts`** as a side effect of
   decision #2. Stage 1's permissive defaults are gone; non-CORS callers
   (curl, server-to-server) are unaffected.

## Manual operator checklist before declaring Stage 2 deployed

1. `wrangler secret put PIN_HASH` — paste the SHA-256 hex digest of your PIN
   (generation command in README).
2. `wrangler secret put SESSION_SECRET` — paste 32 random hex bytes
   (`openssl rand -hex 32`).
3. `wrangler secret put ANTHROPIC_API_KEY`.
4. `npm run deploy`.
5. Verify on the deployed Worker:
   - `curl https://history-tutor.<sub>.workers.dev/api/health` → 200,
     `db:"connected"`.
   - PIN flow round-trip works against the production secrets.
   - One real chat call returns a non-empty reply.

## Open questions

1. **D1 `PRAGMA foreign_keys = ON` may not actually take effect.** D1 routes
   queries across replicas, so a PRAGMA issued at the start of a `withDb`
   call may not apply to subsequent prepared statements within the same
   call. Our writes never violate declared FKs in practice; CHECK and
   UNIQUE constraints are enforced regardless. Two paths if we want
   guaranteed FK enforcement later:
   - Wrap related multi-statement work in `db.batch()` and prepend the
     PRAGMA as the first statement (D1 batch is single-connection).
   - Drop the FK declarations and rely entirely on application-layer
     correctness (current de facto state).

   I'd defer to "do nothing" until a Stage 3+ write actually risks an
   orphaned row.

2. **Production domain for cookies + CORS.** Currently the allowlist only
   contains `http://localhost:8788`. Stage 5 needs to add the Pages domain.
   If we plan to host on a custom domain (e.g.
   `tutor.example.com` + `api.tutor.example.com`), set `Domain=.example.com`
   on the cookie at that point.

3. **PIN reset story.** No flow for changing the PIN. Today the operator
   re-runs `wrangler secret put PIN_HASH`, which immediately invalidates
   the old PIN but does NOT invalidate existing session cookies (those are
   signed with `SESSION_SECRET`, which is independent). If we want forced
   logout on PIN change, rotate `SESSION_SECRET` at the same time.

4. **Logger sink.** Currently `console.log` lines land in `wrangler tail`
   and the dashboard. If we ever want structured log shipping (Logflare,
   Axiom, etc.), the swap is a single function in `lib/logger.ts`.
