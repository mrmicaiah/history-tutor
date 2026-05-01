/**
 * Typed bindings for this Worker.
 *
 * Bindings are wired up in `wrangler.toml`. Adding a binding requires both:
 *   1. A new entry in `wrangler.toml` (or `wrangler secret put` for secrets), and
 *   2. A new field on this interface so call sites are type-checked.
 *
 * Stage 2 will add: `ANTHROPIC_API_KEY`, `PIN_HASH`, `SESSION_SECRET`
 * (all populated via `wrangler secret put`, never committed).
 */
export interface Env {
  /** D1 database binding. Single source of truth for all persistent state. */
  DB: D1Database;
}
