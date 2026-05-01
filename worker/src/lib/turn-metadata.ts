import { log } from './logger';
import { DatabaseError } from './errors';
import type { DbContext } from './db';

/**
 * Helpers for the `turn_metadata` table.
 *
 * Each turn (user or assistant) gets at most one metadata row, keyed by
 * turn_id. Stage 4 writes:
 *   - `input_tokens` on the user-turn row (the call's prompt-side cost)
 *   - `output_tokens` on the assistant-turn row (the call's response-side cost)
 *   - `evaluation` (JSON) on the user-turn row, written by the eval pass
 *
 * `upsertTurnMetadata` is a two-step idempotent write: INSERT OR IGNORE
 * to ensure the row exists, then UPDATE only the supplied fields. This lets
 * the chat handler write tokens synchronously and the background eval pass
 * fill in `evaluation` later without a race.
 */

export interface TurnMetadataFields {
  input_tokens?: number | null;
  output_tokens?: number | null;
  evaluation?: string | null;
}

export async function upsertTurnMetadata(
  db: DbContext,
  turnId: number,
  fields: TurnMetadataFields,
): Promise<void> {
  const now = Date.now();

  try {
    await db.d1
      .prepare('INSERT OR IGNORE INTO turn_metadata (turn_id, created_at) VALUES (?, ?)')
      .bind(turnId, now)
      .run();
  } catch (err) {
    log.error('turn_metadata_insert_failed', { turnId, error: err });
    throw new DatabaseError('failed to upsert turn metadata');
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.input_tokens !== undefined) {
    sets.push('input_tokens = ?');
    values.push(fields.input_tokens);
  }
  if (fields.output_tokens !== undefined) {
    sets.push('output_tokens = ?');
    values.push(fields.output_tokens);
  }
  if (fields.evaluation !== undefined) {
    sets.push('evaluation = ?');
    values.push(fields.evaluation);
  }
  if (sets.length === 0) return;

  values.push(turnId);
  try {
    await db.d1
      .prepare(`UPDATE turn_metadata SET ${sets.join(', ')} WHERE turn_id = ?`)
      .bind(...values)
      .run();
  } catch (err) {
    log.error('turn_metadata_update_failed', { turnId, error: err });
    throw new DatabaseError('failed to update turn metadata');
  }
}

/** Read the eval blob for a turn, or null if not yet evaluated. */
export async function getTurnEvaluation(
  db: DbContext,
  turnId: number,
): Promise<string | null> {
  try {
    const row = await db.d1
      .prepare('SELECT evaluation FROM turn_metadata WHERE turn_id = ?')
      .bind(turnId)
      .first<{ evaluation: string | null }>();
    return row?.evaluation ?? null;
  } catch (err) {
    log.error('turn_metadata_select_failed', { turnId, error: err });
    throw new DatabaseError('failed to load turn metadata');
  }
}
