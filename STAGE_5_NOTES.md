# Stage 5 — Notes

## What was built

The student can now use it. PIN entry → chat surface → reference cards
panel with mastery self-rating → knowledge map view, all over the API
endpoints we've been quietly accumulating since Stage 2. Vanilla
TypeScript bundled with esbuild; no framework. ~13 KB JS, ~11 KB CSS,
mobile-first, system-font sans for chrome and a serif for reading text.

| File / module                                  | Purpose                                                                |
| :--------------------------------------------- | :--------------------------------------------------------------------- |
| `worker/src/types/cards.ts`                    | `ReferenceCard` shape, importable by both worker and frontend.         |
| `worker/src/schemas.ts`                        | Adds `CardPatchSchema` and `CardsQuerySchema`.                         |
| `worker/src/lib/router.ts`                     | Path-param matching (`/api/cards/:id`) + 4th `params` arg to handlers. |
| `worker/src/lib/auth.ts`                       | `createSessionCookie(secret, cookieDomain?)`.                          |
| `worker/src/env.ts`                            | Optional `ALLOWED_ORIGIN`, `COOKIE_DOMAIN` env vars.                   |
| `worker/src/index.ts`                          | Wires `PATCH /api/cards/:id`, derives CORS allowlist from env.         |
| `worker/src/routes/cards.ts`                   | Adds `handleCardPatch`; uses shared `ReferenceCard`.                   |
| `worker/src/routes/state.ts`                   | Adds `recent_turns` to the response payload.                           |
| `worker/src/routes/cards.test.ts`              | 4 PATCH tests via `SELF.fetch` w/ forged session cookie.               |
| `wrangler.toml`                                | Documented `[vars]` block (commented out for dev).                     |
| `pages/build.mjs`                              | esbuild + CSS-concat build script (one-shot or `--watch`).             |
| `pages/public/index.html`                      | Real entrypoint replacing the Stage 1 placeholder.                     |
| `pages/public/favicon.svg`                     | Inline SVG, paper background + ink "h".                                |
| `pages/src/main.ts`                            | Auth-status probe + view mounting.                                     |
| `pages/src/api.ts`                             | `fetch` wrapper, `ApiError`, all endpoint methods.                     |
| `pages/src/state.ts`                           | Tiny observable store + `subscribeSlice` helper.                       |
| `pages/src/lib/{dom,format}.ts`                | DOM helpers + relative-time / era-label / theme-label formatters.      |
| `pages/src/views/pin-gate.ts`                  | PIN entry; surfaces 401 / 429 with proper messaging.                   |
| `pages/src/views/app-shell.ts`                 | Header + tab bar + content area.                                       |
| `pages/src/views/chat.ts`                      | Transcript + sticky composer; debounced post-send refresh.             |
| `pages/src/views/cards.ts`                     | Sortable list w/ flip-to-reveal + mastery PATCH.                       |
| `pages/src/views/map.ts`                       | Era + theme strips, diagnostic notes, weak areas, footer.              |
| `pages/src/styles/{base,chat,cards,map}.css`   | Concatenated to `app.css`.                                             |

Vitest reaches 40 green; all four new PATCH cases (401 / 400 / 404 / 200)
exercise the real Worker entry via `SELF.fetch` so the auth middleware,
router path-param matching, and CORS layer are all verified together.

## Verified locally

| Acceptance criterion                                                                  | Result |
| :------------------------------------------------------------------------------------ | :----: |
| `npm run typecheck` passes                                                            | ✓      |
| `npm run build:pages` produces `pages/public/app.js` (12.9 KB) and `app.css` (11 KB)  | ✓      |
| `npm run test` — **40 green** (36 prior + 4 new PATCH)                                | ✓      |
| Stage 1+2+3+4 endpoints unchanged in behavior                                         | ✓      |
| Migrations apply to a fresh local DB                                                  | ✓      |
| `wrangler dev` (Worker) and `wrangler pages dev pages/public` boot together cleanly   | ✓      |
| CORS preflight from Pages origin (8788) → Worker (8787) returns 204 with PATCH allowed| ✓      |
| `Set-Cookie` carries `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` (no Domain locally) | ✓ |
| `PATCH /api/cards/:id` w/ valid cookie returns the updated card; `times_reviewed +1`  | ✓      |
| `GET /api/state` response includes `recent_turns` array                               | ✓      |
| All files under 300 lines (max: `worker/src/lib/map-merge.ts` at 256)                 | ✓      |
| No `console.*` outside `lib/logger.ts` or the build script                            | ✓      |

## Acceptance criteria deferred to operator manual testing

UI behavior — keyboard handling, scroll-on-focus quirks, visual rhythm —
needs a real browser session and the operator's eye. The build artifacts
prove the bundle is loadable; the API contract is unit-tested. What's left:

| Check                                                              | How                                                                               |
| :----------------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| PIN gate accepts/rejects/rate-limits visibly                       | Open `http://localhost:8788`, try wrong PIN twice then the right one.             |
| Chat round-trip with a real `ANTHROPIC_API_KEY`                    | Type a substantive question; reply renders left-aligned, no `<cards>` leakage.    |
| Cards list populates after a few exchanges; flip-to-reveal works    | Switch to Cards tab; tap a row; mastery buttons update the row optimistically.    |
| Map view: competence cells shade as eras leave "untested"          | Switch to Map tab after several exchanges in Tapestry/Exchange material.          |
| Mobile viewport (375px): tab bar reachable; keyboard doesn't hide composer | iOS Safari + Chrome devtools mobile emulation; rotate. Watch safe-area-inset.     |
| Cookie crosses `tutor.example.com` ↔ `api.tutor.example.com` post-deploy | Auth on prod; reload prod; expect to skip the PIN gate.                           |

## Production domain configuration (operator)

1. **Pick two custom subdomains** under one registered domain. Example pair:
   - Pages: `tutor.example.com`
   - Worker: `api.tutor.example.com`
2. In the Cloudflare dashboard:
   - Pages → Custom domains → add `tutor.example.com`.
   - Workers → Triggers → Custom domains → add `api.tutor.example.com`.
3. Uncomment the `[vars]` block in `wrangler.toml`:
   ```toml
   [vars]
   ALLOWED_ORIGIN = "https://tutor.example.com"
   COOKIE_DOMAIN = ".tutor.example.com"
   ```
4. Set `window.API_BASE` in `pages/public/index.html`:
   ```html
   <script>window.API_BASE = 'https://api.tutor.example.com';</script>
   ```
5. Pages build settings (dashboard → Project → Settings → Build):
   - **Build command**: `npm install && npm run build:pages`
   - **Build output directory**: `pages/public`
   - **Root directory**: blank
6. `npm run deploy` (Worker), then push to the Pages-connected branch.
7. Smoke: `https://api.tutor.example.com/api/health` and the PIN flow on
   `https://tutor.example.com`.

For the alternative `*.workers.dev` / `*.pages.dev` setup (no custom
domain), leave `[vars]` commented and instead set `window.API_BASE` to the
Worker's `*.workers.dev` URL. The cookie will be host-only and won't carry
across origins — meaning the user will have to re-enter the PIN on each
device. Functional but worse.

## Decisions / deviations from the prompt

1. **AppShell mounts all three views once and toggles `display:none`.**
   No view is unmounted, so subscriptions stay live and per-view local
   state (chat draft, expanded cards, scroll position) survives tab
   switches. Avoids the leak/cleanup complexity of per-mount dispose.

2. **No standalone `components/` directory.** The spec sketched one but
   the only candidates (tab bar, message bubble, card flip) were small
   enough to inline as private functions in their hosting view. Less
   navigation, same separation of concerns.

3. **Type sharing via direct relative imports**, not a shared package.
   `pages/src/views/{cards,map}.ts` `import type` from
   `../../../worker/src/types/{cards,knowledge-map}` and runtime-import
   `ERA_IDS`/`THEME_IDS` from `curriculum.ts`. Pages tsconfig adds
   `../worker/src/types/**/*.ts` to its include so TS resolves them.
   The `import type` lines are erased by esbuild thanks to
   `verbatimModuleSyntax`, so Zod is NOT bundled into the page (verified:
   13 KB output, no zod symbols).

4. **`qs` is generic over `T extends object`**, not typed against
   `Record<string, ...>`. Accepts the `CardsQueryParams` interface
   without an awkward index signature; uses `Object.entries` (which is
   typed for any object) internally.

5. **`window.API_BASE` set via inline `<script>` in index.html**, with
   `localhost` autodetection as the dev default. No build-time env
   substitution needed; the operator can override per-deployment with a
   one-line edit.

6. **No animations beyond simple CSS transitions.** Per spec — and
   because gamified motion is exactly the wrong tone for a study tool.

7. **PATCH tests forge the session cookie** by calling
   `createSessionCookie` with the test pool's `SESSION_SECRET` (set in
   `vitest.config.ts` to 64 zeros). Going through `SELF.fetch` exercises
   the auth middleware + router + CORS layer in one shot, which is the
   closest thing to a real client request we can run in vitest.

8. **`window.API_BASE` is intentionally typed loosely** (`string | undefined`
   on the global). Setting it to a string from a script tag is
   structurally simple; richer typing would require a shared frontend
   types module that no other code needs.

## Open questions

1. **No PIN-change UI yet.** Operator still rotates `PIN_HASH` /
   `SESSION_SECRET` via `wrangler secret put` per the Stage 2 notes.
   Could add an in-app PIN-change flow later; not scoped here.

2. **Card mastery progression has no spaced-repetition scheduler.** The
   "weakest first" sort is the only proximity hint; "don't show me what I
   know" requires a scheduler. Out of Stage 5 scope; flag for later.

3. **No streaming chat replies.** Deferred to Stage 6 per Stage 4 notes.
   When added, the chat composer's `sending` state should swap to a
   "streaming" indicator and the `assistant` message should accumulate
   text as it arrives.

4. **Single-user assumption baked into the frontend.** No login / logout
   UI, no account switcher, no profile. If the project ever goes
   multi-user this whole stage gets the most rework; the worker would
   need session→user mapping first.

5. **No dark mode.** Stage 5 ships light-only. Adding dark mode is one
   media query + a token swap in `base.css`; deferred so the look gets
   tuned in light first.

6. **Tab-switching while a chat is sending** doesn't cancel the request
   (the closure keeps running and updates state on completion). On the
   user side this looks correct — they switch back and the tutor's reply
   is there. Documented because future change of this behavior should
   keep that semantic.

7. **The `loadRecentTurns(50)` in `/api/state`** caps at 50 but the
   verbatim window post-compaction is ~21–30. So 50 is the upper safety
   bound, not the typical payload size. If we ever want a longer chat
   scroll-back UI than the verbatim window allows, we'll need to surface
   compacted-summary text or a separate full-history endpoint.

8. **No service worker / offline shell.** Mobile use case might want the
   PIN gate + last-loaded chat available offline. Not in scope; would be
   a Stage 6 nice-to-have.
