# Stage 5.1 — Notes

## What was built

A single Pages Function (`functions/api/[[path]].ts`) that catches every
`/api/*` request on the Pages origin and forwards it to the Worker
(`WORKER_URL` env var). The browser sees one origin; the Worker keeps
being the source of truth. Cookies, CORS, and custom-domain configuration
all simplify away.

| Module / file                               | Purpose                                                                  |
| :------------------------------------------ | :----------------------------------------------------------------------- |
| `functions/api/[[path]].ts`                 | Transparent same-origin proxy. ~30 lines.                                |
| `functions/tsconfig.json`                   | Separate TS project — Functions need `@cloudflare/workers-types`.        |
| `pages/src/api.ts`                          | `API_BASE` indirection deleted; `fetch('/api/...')` directly.            |
| `pages/public/index.html`                   | `window.API_BASE` `<script>` tag removed.                                |
| `wrangler.toml`                             | `[vars]` block uncommented with `ALLOWED_ORIGIN`; `COOKIE_DOMAIN` stays commented. |
| `worker/src/index.ts`                       | `getAllowedOrigins` always keeps localhost fallback in the allowlist.    |
| `package.json`                              | `typecheck` adds `functions/`; `dev:pages` binds `WORKER_URL=…:8787`.   |

## Verified locally

| Acceptance criterion                                                           | Result |
| :----------------------------------------------------------------------------- | :----: |
| `npm run typecheck` (worker + pages + functions, three projects)               | ✓      |
| `npm run test` — **40/40 green** (no regressions)                              | ✓      |
| `npm run build:pages` — JS 12.4 KB (slightly smaller, API_BASE gone)           | ✓      |
| `wrangler pages dev` discovers the Function ("✨ Compiled Worker successfully")| ✓      |
| `curl --compressed http://localhost:8788/api/health` returns Worker's payload  | ✓      |
| `POST http://localhost:8788/api/auth/pin` returns 200 with proxied Set-Cookie  | ✓      |
| Set-Cookie attributes: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=…` (no Domain) | ✓ |
| `GET http://localhost:8788/api/state` w/ proxied cookie returns full payload   | ✓      |
| Direct Worker access (`curl http://localhost:8787/api/health`) still works     | ✓      |
| All files under 300 lines                                                      | ✓      |
| No `console.*` outside `lib/logger.ts`                                         | ✓      |

## Decisions / deviations from the prompt

1. **`functions/` lives at the repo root**, not at `pages/functions/`. The
   spec specified `pages/functions/api/[[path]].ts`, but Cloudflare's
   Pages Functions discovery convention is project-root-anchored — putting
   the directory under `pages/` causes `wrangler pages dev` to print
   `No Functions. Shimming...` and the Cloudflare dashboard would also
   fail to find them on deploy. Moving to `./functions/` matches both
   local and deployed discovery without flag gymnastics.

2. **`functions/tsconfig.json` is a separate TS project.** Pages Functions
   need `@cloudflare/workers-types` for the `PagesFunction<Env>` type;
   the page bundle deliberately doesn't include those globals. Three
   projects total now (`worker`, `pages`, `functions`); root `typecheck`
   runs all three.

3. **`dev:pages` passes `WORKER_URL` via `--binding`**, not via a
   `.dev.vars` file. The repo's `.dev.vars` is for Worker secrets and is
   read by `wrangler dev`; mixing Pages Function bindings into it
   would couple two deployment surfaces. The CLI flag is explicit and
   unambiguous about which dev process gets which env var.

4. **CORS allowlist always includes `http://localhost:8788`** even when
   `env.ALLOWED_ORIGIN` is set (Stage 5 returned only the env value). With
   `[vars]` now uncommented in `wrangler.toml`, local dev would otherwise
   set `ALLOWED_ORIGIN = "https://history-tutor.pages.dev"` and reject
   direct browser→Worker requests on localhost. The fix keeps localhost
   in the list as a fallback. Production behavior is unchanged for
   non-proxy traffic; the proxy doesn't go through CORS at all.

5. **`window.API_BASE` indirection removed entirely.** The frontend now
   makes only same-origin `fetch('/api/...')` calls. No detection logic,
   no override surface in `index.html`. The Worker is reachable
   exclusively via the proxy in normal operation.

6. **Proxy is intentionally minimal.** `new Request(targetUrl, request)`
   then `fetch(proxied)` and that's the entire body. No header
   rewriting, no caching, no body manipulation. The Worker still
   determines auth, validation, status codes, headers, and bodies.

## Acceptance criteria deferred to operator manual testing

| Check                                                                | How                                                                                       |
| :------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| Cloudflare Pages dashboard discovers `functions/api/[[path]].ts`     | Connect repo, deploy; verify `https://<project>.pages.dev/api/health` proxies through.    |
| `WORKER_URL` env var picked up by deployed Pages Function            | Pages project → Settings → Environment variables → Production → set `WORKER_URL`.         |
| Cookie scopes correctly to `*.pages.dev` after PIN entry             | Auth on the Pages site; reload; expect to skip the PIN gate (cookie persisted).           |
| Real chat round-trip via the proxy                                   | Set real `ANTHROPIC_API_KEY` Worker secret; send a message via the deployed Pages site.   |

## Production deployment recipe

1. Deploy the Worker (`npm run deploy`) and copy the printed
   `*.workers.dev` URL.
2. Connect the repo to Cloudflare Pages (dashboard → Workers & Pages →
   Create → Pages → Connect to Git):
   - Build command: `npm install && npm run build:pages`
   - Build output directory: `pages/public`
   - Root directory: blank
   - Production branch: `main`
3. Pages project → Settings → Environment variables → Production → add:
   - `WORKER_URL = https://history-tutor.<your-subdomain>.workers.dev`
   (no trailing slash, no quotes)
4. *(Optional)* Update `ALLOWED_ORIGIN` in `wrangler.toml` `[vars]` to
   match your Pages URL if it differs from `https://history-tutor.pages.dev`.
5. Push to `main`. Pages auto-deploys.
6. Smoke: `curl https://<your-pages-project>.pages.dev/api/health`.

## Open questions

1. **`WORKER_URL` is plaintext in the dashboard.** Not a secret per se
   (it's just a URL), but anyone with dashboard access can see it. If
   that ever becomes sensitive, switch to a Pages secret (same UI but
   marked encrypted). No code change needed — the Function reads it as
   a regular env var either way.

2. **No retry / circuit breaker in the proxy.** A flaky Worker means
   flaky API calls; the frontend's existing error handling shows a
   generic "couldn't reach server" message. Adding one retry inside
   the Function would be ~5 lines but introduces ordering questions
   (don't retry POSTs, etc.) — defer until we see actual flakiness.

3. **Brotli compression at the Pages layer** is a performance bonus
   for free; the Worker emits uncompressed JSON, the Pages edge
   compresses it. Zero code involvement, just noting it.

4. **The Worker's CORS code path is now mostly dead in production**
   (proxy traffic doesn't trigger it). Could be simplified later if we
   commit fully to the proxy, but keeping it costs nothing and leaves
   the door open for direct-Worker access during incident response or
   if we ever want to publish a public read-only endpoint.

5. **Pages Function cold starts** add ~10–50ms to the first request
   after a quiet period. Inside an active session this is invisible.
   For latency-sensitive future work (streaming chat), measure first.

6. **`ALLOWED_ORIGIN` defaults to `https://history-tutor.pages.dev`** —
   if your Pages project ends up named differently (or you use a
   `pages.dev` subdomain assigned by Cloudflare), update it in
   `wrangler.toml` and `npm run deploy` again. Doesn't break anything
   if left wrong; it just means direct-Worker browser access from your
   real Pages origin would 0-out the CORS headers.
