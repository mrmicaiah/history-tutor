import { log } from './logger';
import { DatabaseError } from './errors';

/**
 * D1 helper layer.
 *
 * Centralizes:
 *   - the `PRAGMA foreign_keys = ON` call (issued at the start of every
 *     `withDb` invocation), and
 *   - typed query helpers used by route handlers.
 *
 * Caveat on the PRAGMA: D1 does not guarantee that subsequent prepared
 * statements run on the same underlying connection as the PRAGMA, so the
 * setting may not actually be applied to later queries within the same
 * `withDb` call. Our writes never violate declared FKs in practice; CHECK
 * and UNIQUE constraints are enforced regardless of the PRAGMA. See
 * STAGE_2_NOTES.md for the longer-term plan.
 */

export interface DbContext {
  readonly d1: D1Database;
}

interface EnvWithDb {
  DB: D1Database;
}

/**
 * Open a logical DB context: enable FK enforcement, then run `fn`. Errors
 * from the PRAGMA are translated to `DatabaseError`; errors from `fn` bubble.
 */
export async function withDb<T>(
  env: EnvWithDb,
  fn: (db: DbContext) => Promise<T>,
): Promise<T> {
  try {
    await env.DB.exec('PRAGMA foreign_keys = ON');
  } catch (err) {
    log.error('db_pragma_failed', { error: err });
    throw new DatabaseError('failed to enable foreign keys');
  }
  return fn({ d1: env.DB });
}

export interface TurnRow {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

/**
 * Returns the last `limit` turns for a conversation, ordered chronologically
 * (oldest first). Oldest-first is what Anthropic's Messages API expects.
 */
export async function getRecentTurns(
  db: DbContext,
  conversationId: number,
  limit: number,
): Promise<TurnRow[]> {
  try {
    const result = await db.d1
      .prepare(
        `SELECT id, conversation_id, role, content, created_at
         FROM turns
         WHERE conversation_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(conversationId, limit)
      .all<TurnRow>();
    if (!result.success) {
      log.error('db_select_recent_turns_failed', { error: result.error ?? null });
      throw new DatabaseError('failed to load recent turns');
    }
    return [...(result.results ?? [])].reverse();
  } catch (err) {
    if (err instanceof DatabaseError) throw err;
    log.error('db_select_recent_turns_threw', { error: err });
    throw new DatabaseError('failed to load recent turns');
  }
}

/**
 * Insert a turn. Returns the new turn's id (D1 reports it via meta.last_row_id).
 */
export async function insertTurn(
  db: DbContext,
  conversationId: number,
  role: 'user' | 'assistant',
  content: string,
): Promise<number> {
  const now = Date.now();
  try {
    const result = await db.d1
      .prepare(
        `INSERT INTO turns (conversation_id, role, content, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(conversationId, role, content, now)
      .run();
    if (!result.success) {
      log.error('db_insert_turn_failed', { error: result.error ?? null });
      throw new DatabaseError('failed to insert turn');
    }
    const id = result.meta?.last_row_id;
    if (typeof id !== 'number') {
      log.error('db_insert_turn_no_id', { meta: result.meta ?? null });
      throw new DatabaseError('insert returned no last_row_id');
    }
    return id;
  } catch (err) {
    if (err instanceof DatabaseError) throw err;
    log.error('db_insert_turn_threw', { error: err });
    throw new DatabaseError('failed to insert turn');
  }
}

/** Bump `conversations.updated_at` to now. */
export async function touchConversation(
  db: DbContext,
  conversationId: number,
): Promise<void> {
  const now = Date.now();
  try {
    const result = await db.d1
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .bind(now, conversationId)
      .run();
    if (!result.success) {
      log.error('db_touch_conversation_failed', { error: result.error ?? null });
      throw new DatabaseError('failed to touch conversation');
    }
  } catch (err) {
    if (err instanceof DatabaseError) throw err;
    log.error('db_touch_conversation_threw', { error: err });
    throw new DatabaseError('failed to touch conversation');
  }
}
