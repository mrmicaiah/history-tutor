# history-tutor

A single-student web app that prepares one user for the AP World History:
Modern exam through adaptive Socratic tutoring backed by the Anthropic Claude
API. The app remembers what the student knows, what they have struggled with,
and which terms they still need to master, and it adapts each subsequent
session to push on the right edges.

## Stack

- **Cloudflare Pages** — frontend hosting
- **Cloudflare Workers** — API and all backend logic
- **Cloudflare D1** — SQLite, the single source of truth for persistent state
- **Anthropic Claude API** — tutor and evaluation passes (added in Stage 2)
- **TypeScript** strict mode throughout
- **Vanilla HTML/CSS/TS** on the frontend (no React/Vue/Svelte)
- **Wrangler** for local dev and deployment
- **Vitest** for tests

The frontend never calls Anthropic directly. Every Claude call goes through
the Worker, and the API key lives only as a Worker secret.

## Local development

Prerequisites: Node 20+ and a Cloudflare account.

```sh
npm install
cp .dev.vars.example .dev.vars        # then fill in PIN_HASH, SESSION_SECRET, ANTHROPIC_API_KEY
npm run db:migrate:local              # apply migrations to the local Miniflare D1
npm run dev                           # start `wrangler dev` on http://localhost:8787
```

Smoke-test:

```sh
curl http://localhost:8787/api/health
# => {"ok":true,"version":"stage-2","db":"connected"}
```

Other handy scripts:

```sh
npm run typecheck             # tsc --noEmit on both worker/ and pages/
npm run test                  # vitest (no tests yet; runner verified)
```

## Initial Cloudflare setup (one time)

### 1. Create the D1 database

```sh
wrangler d1 create history_tutor_db
# Copy the printed `database_id` into wrangler.toml (replace REPLACE_WITH_ACTUAL_ID).
npm run db:migrate:remote
```

### 2. Set Worker secrets

The chat and auth routes will not function until all three of these are set
in production. Generate values locally, then push each one with `wrangler
secret put`:

```sh
# PIN_HASH — SHA-256 hex digest of your PIN. The PIN itself never leaves your
# machine and is never stored anywhere.
echo -n "YOUR_PIN" | shasum -a 256 | awk '{print $1}'
wrangler secret put PIN_HASH        # paste the hex digest at the prompt

# SESSION_SECRET — 32 random hex bytes used to HMAC session cookies.
openssl rand -hex 32
wrangler secret put SESSION_SECRET  # paste the value at the prompt

# ANTHROPIC_API_KEY — from https://console.anthropic.com.
wrangler secret put ANTHROPIC_API_KEY
```

For local dev, place the same three values in `.dev.vars` (gitignored).

### 3. Voice output (Stage 6.1)

Tutor replies are spoken via ElevenLabs, with a per-text R2 cache so
repeated phrases don't re-bill. Two new secrets and one new R2 bucket:

```sh
# Create the audio cache bucket once
npx wrangler r2 bucket create history-tutor-audio

# ElevenLabs API key — https://elevenlabs.io/app/settings/api-keys
npx wrangler secret put ELEVENLABS_API_KEY

# Voice id (Stage 6.1 default)
npx wrangler secret put ELEVENLABS_VOICE_ID
# paste: qSeXEcewz7tA0Q0qk9fH

npm run deploy
```

For local dev, add `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` to
`.dev.vars` (the example file lists them). `wrangler dev --local` provides
an in-memory R2 replacement, so the bucket doesn't need to exist for
local testing.

## Deployment

```sh
npm run deploy
```

This runs `wrangler deploy`, which uploads `worker/src/index.ts` and wires it
to the bindings declared in `wrangler.toml`. It does **not** touch D1 schema —
run `npm run db:migrate:remote` separately when migrations change.

The Pages frontend (`pages/public/`) is deployed via the Cloudflare dashboard
or `wrangler pages deploy pages/public`. Stage 1 ships only a placeholder.

## Project status

| Stage | Description                                         | Status |
| ----: | --------------------------------------------------- | :----: |
|     1 | Scaffolding, D1 schema, health check                |   ✓    |
|     2 | Chat route, PIN gate, Claude integration, logging   |   ✓    |
|     3 | Knowledge map + summary + compaction (memory layer) |   ✓    |
|     4 | Real tutor prompt + evaluation pass + cards         |   ✓    |
|     5 | Frontend (PIN, chat, cards, map; PATCH cards)       |   ✓    |
|   5.1 | Pages Function proxy → same-origin deployment       |   ✓    |
|   6.1 | Voice output (ElevenLabs TTS + R2 cache + autoplay) |   ✓    |
|   6.2 | Personal touches (Kayla's name + welcome / thinking)|   ✓    |
|   6.3 | Audio UX: single header toggle + tap-to-replay      |   ✓    |
|   6.4 | Replay hint label in chat header                    |   ✓    |

## API surface

| Method | Path               | Description                                                                    |
| -----: | :----------------- | :----------------------------------------------------------------------------- |
|    GET | `/api/health`      | Liveness + DB binding probe. Public.                                           |
|   POST | `/api/auth/pin`    | Body `{pin}`; on success sets `htsess` cookie. 5/5min per IP.                  |
|    GET | `/api/auth/status` | Returns `{authenticated: bool}`. Public.                                       |
|   POST | `/api/chat`        | Body `{message}` → `{reply}`. Auth required. 30/min. Triggers eval+compaction. |
|    GET | `/api/state`       | Returns `{map, summary, turn_count, recent_turns}`. Auth required.             |
|    GET | `/api/cards`       | Paginated reference cards. Query: `sort`/`limit`/`offset`/`category`/`era`.    |
|  PATCH | `/api/cards/:id`   | Body `{mastery: 0..5}` → `{card}`. Auth required. Increments times_reviewed.   |
|   POST | `/api/tts`         | Body `{text}` → audio/mpeg. Auth required. R2-cached, 20/min.                  |

## Frontend (Stage 5)

The frontend is vanilla TypeScript bundled with esbuild. No framework.

### Local development (two processes)

```sh
# 1. Worker on :8787
npm run dev

# 2. In another terminal, build + serve the static frontend on :8788
npm run build:pages   # one-shot build
npm run dev:pages     # `wrangler pages dev pages/public` with WORKER_URL bound to localhost:8787

# Optional 3. Auto-rebuild on save
npm run watch:pages
```

The frontend talks to `/api/*` only. `wrangler pages dev` discovers the
catch-all proxy at `functions/api/[[path]].ts` and forwards every API call
to the local Worker, so the browser sees a single origin (`localhost:8788`)
and the session cookie flows naturally without CORS or domain config.

Smoke-test the proxy:

```sh
curl --compressed http://localhost:8788/api/health
# => {"ok":true,"version":"stage-2","db":"connected"}
```

### Production deployment (same-origin via Pages Function proxy)

This is the path used when the Worker lives at `*.workers.dev` and Pages at
`*.pages.dev` — no custom domain needed. The Pages Function at
`functions/api/[[path]].ts` makes everything same-origin.

1. **Deploy the Worker** (`npm run deploy`). Note the printed URL, e.g.
   `https://history-tutor.<your-subdomain>.workers.dev`.
2. **Connect the repo to Cloudflare Pages** (dashboard → Workers & Pages →
   Create → Pages → Connect to Git). Build settings:
   - Build command: `npm install && npm run build:pages`
   - Build output directory: `pages/public`
   - Root directory: leave blank
   - Production branch: `main`
3. **Set the `WORKER_URL` Pages env var** (Pages project → Settings →
   Environment variables → Production):
   - `WORKER_URL = https://history-tutor.<your-subdomain>.workers.dev`
   (no trailing slash, no quotes)
4. **(Optional) Update `ALLOWED_ORIGIN`** in `wrangler.toml`'s `[vars]`
   block to match your Pages URL if it differs from the default
   `https://history-tutor.pages.dev`. This only matters for direct
   browser→Worker access; the proxy is server-to-server and bypasses CORS.
5. **First Pages deploy** triggers automatically on the next push to `main`.
6. **Verify**: open the Pages URL, enter your PIN, send a message.

If you'd rather use a custom-domain pair (e.g. `tutor.example.com` +
`api.tutor.example.com`) instead of the proxy, set both `ALLOWED_ORIGIN`
and `COOKIE_DOMAIN` in `wrangler.toml`'s `[vars]` block; the cookie's
`Domain=.your-domain.com` makes it work cross-subdomain. The proxy is
unused in that case.

## Repository layout

```
history-tutor/
├── worker/
│   ├── src/                  # Worker entrypoint, env types, helpers
│   └── migrations/           # D1 schema migrations (numbered)
├── pages/
│   ├── public/               # Static assets served by Pages
│   └── src/                  # Frontend TS (Stage 5)
├── functions/                # Pages Functions (same-origin /api/* proxy)
│   └── api/[[path]].ts       # Catch-all proxy → WORKER_URL
├── wrangler.toml             # Worker + bindings config
├── tsconfig.base.json        # Shared TS config (strict)
├── vitest.config.ts          # Test runner config
└── package.json
```
