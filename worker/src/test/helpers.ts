import { env } from 'cloudflare:test';
import type { DbContext } from '../lib/db';

/**
 * Test helpers.
 *
 * `dbCtx()` returns a `DbContext` pointing at the test D1 binding so memory
 * helpers can be called with the same shape they see in production.
 *
 * `resetTables()` truncates everything except the seed conversation row, so
 * `beforeEach` can give every `it` a clean slate.
 *
 * `insertTurn{,s}()` insert directly via D1 (bypassing the production lib so
 * tests don't share failure paths with the code under test).
 */

export function dbCtx(): DbContext {
  return { d1: env.DB };
}

/** Empty all per-conversation tables; leave migrations + the seed row alone. */
export async function resetTables(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM turn_metadata'),
    env.DB.prepare('DELETE FROM rate_limit'),
    env.DB.prepare('DELETE FROM reference_cards'),
    env.DB.prepare('DELETE FROM conversation_summary'),
    env.DB.prepare('DELETE FROM knowledge_map'),
    env.DB.prepare('DELETE FROM turns'),
    env.DB.prepare("DELETE FROM sqlite_sequence WHERE name = 'turns'"),
  ]);
}

export async function insertTurn(
  conversationId: number,
  role: 'user' | 'assistant',
  content: string,
  createdAt: number = Date.now(),
): Promise<number> {
  const result = await env.DB
    .prepare(
      'INSERT INTO turns (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(conversationId, role, content, createdAt)
    .run();
  const id = result.meta.last_row_id;
  if (typeof id !== 'number') throw new Error('insertTurn: missing last_row_id');
  return id;
}

/**
 * Insert `count` alternating user/assistant turns with strictly-increasing
 * `created_at` timestamps. Returns the inserted turn ids in order.
 */
export async function insertTurns(
  count: number,
  conversationId: number = 1,
  startMs: number = 1_700_000_000_000,
): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const role: 'user' | 'assistant' = i % 2 === 0 ? 'user' : 'assistant';
    const id = await insertTurn(conversationId, role, `turn ${i + 1}`, startMs + i);
    ids.push(id);
  }
  return ids;
}
