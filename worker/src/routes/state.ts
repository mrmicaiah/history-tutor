import type { Env } from '../env';
import { json } from '../lib/responses';
import { requireAuth } from '../lib/auth';
import { withDb } from '../lib/db';
import { loadKnowledgeMap, loadSummary } from '../lib/memory';
import { CONVERSATION_ID } from '../config';

/**
 * GET /api/state
 *
 * Returns the current knowledge map plus summary metadata. Used by the
 * frontend (Stage 5) to render "what does the tutor think I know?". The
 * map can be large; we send the whole thing because rendering tabs / charts
 * over it is the frontend's job.
 *
 * `turn_count` is the total number of turns ever recorded in the
 * conversation, including those folded into the summary. Computed as
 * (current verbatim count) + (last_compacted_turn_id). This is exact for the
 * single-conversation / sequential-id setup but would need a counter column
 * if we ever go multi-conversation per process.
 */
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

    return json({
      map,
      summary: {
        text: summary.summary,
        last_compacted_turn_id: summary.last_compacted_turn_id,
        updated_at_ms: summaryUpdatedRow?.updated_at ?? null,
      },
      turn_count: turnCount,
    });
  });
}
