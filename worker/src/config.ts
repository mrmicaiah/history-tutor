/**
 * Centralized constants for the Worker. Anything that might reasonably need
 * to change without touching call sites lives here. Per the project rule
 * against magic numbers, handlers and lib files import from this module
 * rather than hardcoding.
 */

/** The single conversation row id. Stage 1 seeded `conversations(id=1)`. */
export const CONVERSATION_ID = 1 as const;

/** Anthropic model used for the tutor chat call. */
export const CLAUDE_MODEL = 'claude-sonnet-4-5';

/** Anthropic Messages API endpoint. */
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/** `anthropic-version` header. Pinned per Anthropic's stability contract. */
export const ANTHROPIC_VERSION = '2023-06-01';

/** Wall-clock budget for an Anthropic call before we abort and surface 504. */
export const ANTHROPIC_TIMEOUT_MS = 60_000;

/** How many recent turns to load as context for each Claude call. */
export const MAX_RECENT_TURNS = 20;

/** Token budget for the tutor's reply. Enough room for ~200 words + slack. */
export const MAX_OUTPUT_TOKENS_CHAT = 1024;

/** Per-window limits used by `checkRateLimit`. */
export const RATE_LIMIT_CHAT_PER_MIN = 30;
export const RATE_LIMIT_CHAT_WINDOW_S = 60;
export const RATE_LIMIT_PIN_PER_5MIN = 5;
export const RATE_LIMIT_PIN_WINDOW_S = 300;

/** Session cookie lifetime. 30 days * 24h * 60m * 60s * 1000ms. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Cookie name issued by the auth flow. */
export const SESSION_COOKIE_NAME = 'htsess';

/**
 * CORS allowlist for the Pages frontend. Cross-origin requests from any
 * origin not in this list receive no CORS headers (browsers will block them);
 * direct, non-CORS requests (e.g. curl) are unaffected.
 *
 * The production Pages domain is finalized in Stage 5. Until then only
 * `wrangler pages dev` (default port 8788) is whitelisted.
 */
export const CORS_ALLOWED_ORIGINS: ReadonlyArray<string> = [
  'http://localhost:8788',
];

/** Max body size accepted on /api/chat (matches the Zod schema). */
export const MAX_CHAT_MESSAGE_CHARS = 8000;

// ---------------------------------------------------------------------------
// Compaction (Stage 3)
// ---------------------------------------------------------------------------

/** Verbatim turns above this count trigger a compaction pass. */
export const COMPACTION_TRIGGER_TURNS = 30;

/** Number of oldest turns folded into the summary per compaction pass. */
export const COMPACTION_BATCH_SIZE = 10;

/**
 * Steady-state floor for the verbatim window after a compaction pass.
 * Informational only -- the actual floor is `TRIGGER - BATCH_SIZE` and is
 * enforced by the trigger / batch values above. Kept as a named constant so
 * the chosen behavior is self-documenting.
 */
export const COMPACTION_KEEP_RECENT = 20;

/**
 * Smaller / cheaper model for the summarization pass. Compaction does not
 * need the tutor's reasoning quality -- it's compressive paraphrase.
 */
export const COMPACTION_MODEL = 'claude-haiku-4-5';

/** Token budget for the summary text. ~300-500 words plus headroom. */
export const MAX_OUTPUT_TOKENS_COMPACTION = 1500;

// ---------------------------------------------------------------------------
// Evaluation pass (Stage 4)
// ---------------------------------------------------------------------------

/** Smaller model for the eval pass. JSON extraction doesn't need Sonnet. */
export const EVALUATION_MODEL = 'claude-haiku-4-5';

/** Token budget for the JSON eval record. ~200-400 tokens of JSON + headroom. */
export const MAX_OUTPUT_TOKENS_EVALUATION = 800;

/** How many recent turns the eval pass sees (oldest first). */
export const EVALUATION_CONTEXT_TURNS = 6;

// ---------------------------------------------------------------------------
// Knowledge map merge caps (Stage 4)
// ---------------------------------------------------------------------------

/** Hard cap on the `weak_areas` array. Older entries are dropped on overflow. */
export const MAX_WEAK_AREAS = 20;

/** Hard cap on `diagnostic_notes` length in characters. Head is truncated. */
export const MAX_DIAGNOSTIC_NOTES_CHARS = 2000;

/** Threshold beyond which a skill observation can lower the recorded strength. */
export const SKILL_FORGET_THRESHOLD_TURNS = 10;

/** Per-message cap on cards extracted from the tutor's reply. */
export const MAX_CARDS_PER_MESSAGE = 5;

/** Truncate per-card weak-area entries to this length. */
export const MAX_WEAK_AREA_CHARS = 200;
