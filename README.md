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
npm run db:migrate:local      # apply migrations to the local Miniflare D1
npm run dev                   # start `wrangler dev` on http://localhost:8788
```

Smoke-test:

```sh
curl http://localhost:8788/api/health
# => {"ok":true,"version":"stage-1","db":"connected"}
```

Other handy scripts:

```sh
npm run typecheck             # tsc --noEmit on both worker/ and pages/
npm run test                  # vitest (no tests yet; runner verified)
```

## Initial Cloudflare setup (one time)

The Worker will not deploy until you create the production D1 database and
paste its id into `wrangler.toml`.

```sh
# 1. Create the database
wrangler d1 create history_tutor_db

# 2. Copy the printed `database_id` value into wrangler.toml
#    (replace the REPLACE_WITH_ACTUAL_ID placeholder).

# 3. Apply the schema to the remote database
npm run db:migrate:remote
```

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
|     2 | Chat route, PIN gate, Claude integration, logging   |   —    |
|     3 | Knowledge map types and persistence                 |   —    |
|     4 | Compaction job and evaluation pass                  |   —    |
|     5 | Frontend                                            |   —    |

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
