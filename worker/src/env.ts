/**
 * Typed bindings for this Worker.
 *
 * Required (Stage 2 secrets):
 *   `DB`                — D1 binding (wrangler.toml).
 *   `ANTHROPIC_API_KEY` — set with `wrangler secret put ANTHROPIC_API_KEY`.
 *   `PIN_HASH`          — SHA-256 hex digest of the user's PIN.
 *   `SESSION_SECRET`    — 32 random hex bytes used to HMAC session cookies.
 *
 * Optional (Stage 5 deployment configuration; declared in `wrangler.toml`
 * under `[vars]`):
 *   `ALLOWED_ORIGIN`  — e.g. "https://tutor.example.com". When unset, the
 *                       CORS allowlist falls back to `http://localhost:8788`
 *                       so local dev keeps working.
 *   `COOKIE_DOMAIN`   — e.g. ".tutor.example.com" so the session cookie is
 *                       readable from both the Pages and Worker subdomains.
 *                       When unset, no `Domain=` attribute is set on the
 *                       cookie (host-only cookie, fine for `*.workers.dev`).
 */
export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  PIN_HASH: string;
  SESSION_SECRET: string;
  ALLOWED_ORIGIN?: string;
  COOKIE_DOMAIN?: string;
}
