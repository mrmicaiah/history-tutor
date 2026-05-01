-- 0002_memory.sql
--
-- Adds per-turn metadata. The Stage 1 schema already declared
-- `conversation_summary` and `knowledge_map`; do NOT recreate them here.
-- Migrations are append-only.
--
-- `turn_metadata` is keyed by turn id and cascades on delete so the
-- compaction job (which deletes verbatim turns after summarizing them)
-- doesn't leave orphan metadata rows. Cascade requires the connection to
-- have `PRAGMA foreign_keys = ON` at delete time -- compaction issues that
-- PRAGMA as the first statement of its `db.batch()` so the FK fires.

CREATE TABLE IF NOT EXISTS turn_metadata (
  turn_id        INTEGER PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  -- JSON blob carrying the Stage 4 evaluation result for this turn.
  -- Nullable; Stage 3 leaves it empty.
  evaluation     TEXT,
  created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turn_metadata_created_at
  ON turn_metadata (created_at);
