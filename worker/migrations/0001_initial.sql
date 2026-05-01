-- 0001_initial.sql
--
-- Initial schema for the layered memory model that powers the tutor.
--
-- Conventions:
--   * Timestamps are INTEGER unix epoch milliseconds (sortable, lightweight,
--     timezone-free). The Worker is the single writer and uses Date.now().
--   * Foreign keys are declared but D1 does not enforce them by default; the
--     Worker should issue `PRAGMA foreign_keys = ON;` per request once it
--     starts doing relational writes (Stage 2). See STAGE_1_NOTES.md.
--   * Stage 1 is single-user / single-conversation. The schema does not
--     hardcode that constraint -- the simplification lives in the seed row
--     at the end of this file (id = 1) and in the application layer.

-- ---------------------------------------------------------------------------
-- Conversations
-- One row per ongoing tutor thread. Stage 1 ships exactly one row (id = 1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Turns
-- Verbatim transcript of recent exchanges. Older turns are summarized into
-- `conversation_summary` and then deleted from this table by the compaction
-- job (Stage 4). Order within a conversation is by `created_at` then `id`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS turns (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turns_conversation_recent
  ON turns (conversation_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Conversation summary
-- A single compressed narrative per conversation. The compaction job rewrites
-- this row whenever it ingests new turns, recording the highest turn id it
-- folded in via `last_compacted_turn_id` so the next pass can pick up cleanly.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_summary (
  conversation_id        INTEGER PRIMARY KEY REFERENCES conversations(id),
  summary                TEXT NOT NULL,
  last_compacted_turn_id INTEGER,
  updated_at             INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Knowledge map
-- The structured "what does the tutor know about this student" record.
-- One row per conversation. Updated after every student turn by the
-- evaluation pass (Stage 4). The shape of `data` is documented alongside
-- the TypeScript type that mirrors it (worker/src/types.ts, added in Stage 3).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge_map (
  conversation_id INTEGER PRIMARY KEY REFERENCES conversations(id),
  data            TEXT NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Reference cards
-- Discrete testable items the tutor has surfaced. Used both for spaced
-- review and as the lookup table when the student asks "what was X again?".
-- A `(conversation_id, term)` uniqueness constraint prevents duplicates;
-- callers should UPSERT rather than blindly INSERT.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reference_cards (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id    INTEGER NOT NULL REFERENCES conversations(id),
  term               TEXT NOT NULL,
  category           TEXT NOT NULL CHECK (
    category IN ('person', 'event', 'date', 'place', 'term', 'concept')
  ),
  definition         TEXT NOT NULL,
  era                TEXT,
  theme              TEXT,
  first_seen_turn_id INTEGER REFERENCES turns(id),
  times_reviewed     INTEGER NOT NULL DEFAULT 0,
  mastery            INTEGER NOT NULL DEFAULT 0 CHECK (mastery BETWEEN 0 AND 5),
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL,
  UNIQUE (conversation_id, term)
);

CREATE INDEX IF NOT EXISTS idx_reference_cards_weak_first
  ON reference_cards (conversation_id, mastery ASC);

-- ---------------------------------------------------------------------------
-- Rate limit
-- Simple per-bucket counter table. Bucket keys encode the route and a time
-- window (e.g. "chat:2026-04-30T14:23"). The chat route (Stage 2) writes here
-- to refuse runaway request loops. A periodic cleanup is not required at this
-- scale; old rows can be GC'd by the same code that writes them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_limit (
  bucket     TEXT PRIMARY KEY,
  count      INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Seed: the single conversation row.
-- The application is single-user / single-thread for now and references this
-- row by id = 1 everywhere. INSERT OR IGNORE makes the migration idempotent.
-- Timestamps use 0 because the row predates any real activity; the first turn
-- write will bump `updated_at` to a real value.
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO conversations (id, created_at, updated_at)
VALUES (1, 0, 0);
