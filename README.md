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
|     3 | Knowledge map types and persistence                 |   —    |
|     4 | Compaction job and evaluation pass                  |   —    |
|     5 | Frontend                                            |   —    |

## API surface (Stage 2)

| Method | Path               | Description                                                          |
| -----: | :----------------- | :------------------------------------------------------------------- |
|    GET | `/api/health`      | Liveness + DB binding probe. Public.                                 |
|   POST | `/api/auth/pin`    | Body `{pin}`; on success sets `htsess` cookie. 5/5min per IP.        |
|    GET | `/api/auth/status` | Returns `{authenticated: bool}`. Public.                             |
|   POST | `/api/chat`        | Body `{message}`; returns `{reply}`. Auth required. 30/min global.   |

## Repository layout

```
history-tutor/
├── worker/
│   ├── src/                  # Worker entrypoint, env types, helpers
│   └── migrations/           # D1 schema migrations (numbered)
├── pages/
│   ├── public/               # Static assets served by Pages
│   └── src/                  # Frontend TS (Stage 5)
├── wrangler.toml             # Worker + bindings config
├── tsconfig.base.json        # Shared TS config (strict)
├── vitest.config.ts          # Test runner config
└── package.json
```
