/**
 * Typed bindings for this Worker.
 *
 * Required (Stage 2 secrets):
 *   `DB`                — D1 binding (wrangler.toml).
 *   `ANTHROPIC_API_KEY` — set with `wrangler secret put ANTHROPIC_API_KEY`.
 *   `PIN_HASH`          — SHA-256 hex digest of the user's PIN.
 *   `SESSION_SECRET`    — 32 random hex bytes used to HMAC session cookies.
 *
 * Required (Stage 6.1 — voice output):
 *   `AUDIO_CACHE`         — R2 bucket binding for cached TTS audio.
 *   `ELEVENLABS_API_KEY`  — secret. Account API key from elevenlabs.io.
 *   `ELEVENLABS_VOICE_ID` — secret. The voice id baked into the cache key.
 *
 * Optional (Stage 5 deployment configuration; declared in `wrangler.toml`
 * under `[vars]`):
 *   `ALLOWED_ORIGIN`  — Pages origin for direct browser access. When unset,
 *                       falls back to `http://localhost:8788` only.
 *   `COOKIE_DOMAIN`   — When using a custom-domain pair instead of the
 *                       Pages Function proxy, set this to the shared parent
 *                       (e.g. ".tutor.example.com"). Unused with the proxy.
 */
export interface Env {
  DB: D1Database;
  AUDIO_CACHE: R2Bucket;
  ANTHROPIC_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_VOICE_ID: string;
  PIN_HASH: string;
  SESSION_SECRET: string;
  ALLOWED_ORIGIN?: string;
  COOKIE_DOMAIN?: string;
}
