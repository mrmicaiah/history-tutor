import type { Env } from '../env';
import { json } from '../lib/responses';
import { requireAuth } from '../lib/auth';
import { withDb } from '../lib/db';
import { loadKnowledgeMap, loadRecentTurns, loadSummary } from '../lib/memory';
import { CONVERSATION_ID } from '../config';

/**
 * GET /api/state
 *
 * Single payload that hydrates the entire frontend on first paint:
 *
 *   {
 *     map:           KnowledgeMap,
 *     summary:       { text, last_compacted_turn_id, updated_at_ms },
 *     turn_count:    number,                   // total ever, including compacted
 *     recent_turns:  Array<{ role, content, ts }>,  // chronological, oldest first
 *   }
 *
 * `recent_turns` is the verbatim window from `loadRecentTurns(50)`. The
 * verbatim window is bounded by the compaction trigger (~30 turns), so
 * the actual length is whatever survives in `turns` after compaction —
 * 50 is just an upper safety cap.
 *
 * `turn_count` is `verbatimCount + last_compacted_turn_id`. Exact for the
 * single-conversation, sequential-id setup; would need a counter column
 * for multi-conversation environments.
 */

const RECENT_TURNS_LIMIT = 50;

export async function handleState(req: Request, env: Env): Promise<Response> {
  await requireAuth(req, env);
  return withDb(env, async (db) => {
    const map = await loadKnowledgeMap(db, CONVERSATION_ID);
    const summary = await loadSummary(db, CONVERSATION_ID);

    const summaryUpdatedRow = await db.d1
      .prepare('SELECT updated_at FROM conversation_summary WHERE conversation_id = ?')
      .bind(CONVERSATION_ID)
      .first<{ updated_at: number }>();

    const verbatimCountRow = await db.d1
      .prepare('SELECT COUNT(*) AS c FROM turns WHERE conversation_id = ?')
      .bind(CONVERSATION_ID)
      .first<{ c: number }>();
    const verbatimCount = verbatimCountRow?.c ?? 0;
    const turnCount = verbatimCount + (summary.last_compacted_turn_id ?? 0);

    const recent = await loadRecentTurns(db, CONVERSATION_ID, RECENT_TURNS_LIMIT);

    return json({
      map,
      summary: {
        text: summary.summary,
        last_compacted_turn_id: summary.last_compacted_turn_id,
        updated_at_ms: summaryUpdatedRow?.updated_at ?? null,
      },
      turn_count: turnCount,
      recent_turns: recent.map((t) => ({
        role: t.role,
        content: t.content,
        ts: t.created_at,
      })),
    });
  });
}
