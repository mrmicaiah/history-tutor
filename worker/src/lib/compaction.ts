import type { Env } from '../env';
import { log } from './logger';
import { DatabaseError } from './errors';
import { withDb } from './db';
import { loadSummary } from './memory';
import {
  callClaude as defaultCallClaude,
  type CallClaudeParams,
  type ClaudeResult,
} from './anthropic';
import {
  COMPACTION_BATCH_SIZE,
  COMPACTION_MODEL,
  COMPACTION_TRIGGER_TURNS,
  MAX_OUTPUT_TOKENS_COMPACTION,
} from '../config';

/**
 * Conversation compaction.
 *
 * The chat route calls `compactIfNeeded(env, id)` from `ctx.waitUntil()` after
 * persisting an assistant turn, so the user gets their reply immediately and
 * compaction runs in the background. If compaction fails the conversation is
 * still intact -- the next turn will retry.
 *
 * Trigger / batching:
 *   - Verbatim count > COMPACTION_TRIGGER_TURNS (default 30) ==> compact.
 *   - Compact the oldest COMPACTION_BATCH_SIZE turns (default 10).
 *   - Steady state therefore lives between ~20 and 30 verbatim turns.
 *
 * Atomicity:
 *   - The Claude summarization call happens BEFORE any DB writes. If it
 *     fails, no turns are deleted (most common failure mode -- network /
 *     model error / rate limit upstream).
 *   - The summary update + verbatim DELETE run inside a single `db.batch()`
 *     so either both apply or neither does. The batch's first statement is
 *     `PRAGMA foreign_keys = ON` -- this is the one place in the codebase
 *     where the PRAGMA reliably affects subsequent statements (D1 batches
 *     share a connection), and it lets the `turn_metadata` ON DELETE CASCADE
 *     fire correctly.
 */

export interface CompactionDeps {
  callClaude: (params: CallClaudeParams) => Promise<ClaudeResult>;
}

const DEFAULT_DEPS: CompactionDeps = { callClaude: defaultCallClaude };

interface BatchTurn {
  id: number;
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Run compaction if the verbatim window is over the trigger. Returns the
 * number of turns folded into the summary (0 if no-op).
 *
 * `deps.callClaude` is dependency-injected so tests can pass a fake without
 * needing to mock the anthropic module in the workers vitest pool.
 */
export async function compactIfNeeded(
  env: Env,
  conversationId: number,
  deps: CompactionDeps = DEFAULT_DEPS,
): Promise<number> {
  return withDb(env, async (db) => {
    const summary = await loadSummary(db, conversationId);
    const watermark = summary.last_compacted_turn_id ?? 0;

    const countRow = await db.d1
      .prepare('SELECT COUNT(*) AS c FROM turns WHERE conversation_id = ? AND id > ?')
      .bind(conversationId, watermark)
      .first<{ c: number }>();
    const verbatimCount = countRow?.c ?? 0;
    if (verbatimCount <= COMPACTION_TRIGGER_TURNS) return 0;

    const batchResult = await db.d1
      .prepare(
        `SELECT id, role, content FROM turns
         WHERE conversation_id = ? AND id > ?
         ORDER BY id ASC
         LIMIT ?`,
      )
      .bind(conversationId, watermark, COMPACTION_BATCH_SIZE)
      .all<BatchTurn>();
    const batch: BatchTurn[] = batchResult.results ?? [];
    if (batch.length === 0) return 0;

    const newSummary = await summarize(env, deps, summary.summary, batch);
    if (newSummary.length === 0) {
      log.warn('compaction_empty_summary', { conversationId });
      return 0;
    }

    const lastBatchId = batch[batch.length - 1]!.id;
    const now = Date.now();

    try {
      await env.DB.batch([
        env.DB.prepare('PRAGMA foreign_keys = ON'),
        env.DB
          .prepare(
            `INSERT INTO conversation_summary (conversation_id, summary, last_compacted_turn_id, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(conversation_id) DO UPDATE SET
               summary = excluded.summary,
               last_compacted_turn_id = excluded.last_compacted_turn_id,
               updated_at = excluded.updated_at`,
          )
          .bind(conversationId, newSummary, lastBatchId, now),
        env.DB
          .prepare('DELETE FROM turns WHERE conversation_id = ? AND id <= ?')
          .bind(conversationId, lastBatchId),
      ]);
    } catch (err) {
      log.error('compaction_batch_failed', { conversationId, error: err });
      throw new DatabaseError('compaction batch failed');
    }

    log.info('compaction_completed', {
      conversationId,
      compacted_count: batch.length,
      new_watermark: lastBatchId,
      summary_chars: newSummary.length,
    });
    return batch.length;
  });
}

/**
 * Send the existing summary plus the new batch of turns to Claude and ask
 * for an updated narrative. The prompt explicitly asks for a narrative
 * (not bullets) because bullets compress poorly and lose the connective
 * tissue between facts.
 */
async function summarize(
  env: Env,
  deps: CompactionDeps,
  existingSummary: string,
  batch: BatchTurn[],
): Promise<string> {
  const turnsText = batch
    .map((t) => `${t.role === 'user' ? 'Student' : 'Tutor'}: ${t.content}`)
    .join('\n\n');

  const prompt = `You are maintaining a running narrative summary of a tutoring conversation between a tutor and an AP World History student. The summary tracks what the student has demonstrated, struggled with, and been taught.

EXISTING SUMMARY:
${existingSummary || 'None yet.'}

NEW EXCHANGES (oldest first):
${turnsText}

Produce an updated summary that integrates the new exchanges into the existing narrative. Preserve specific facts, names, dates, and the student's apparent strengths and weaknesses. Aim for ~300-500 words. Output ONLY the updated summary, no preamble or formatting.`;

  const result = await deps.callClaude({
    apiKey: env.ANTHROPIC_API_KEY,
    model: COMPACTION_MODEL,
    systemPrompt: '',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: MAX_OUTPUT_TOKENS_COMPACTION,
  });
  return result.content.trim();
}
