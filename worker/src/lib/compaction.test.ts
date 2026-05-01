import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { compactIfNeeded, type CompactionDeps } from './compaction';
import { loadRecentTurns } from './memory';
import {
  COMPACTION_BATCH_SIZE,
  COMPACTION_TRIGGER_TURNS,
  CONVERSATION_ID,
} from '../config';
import type { ClaudeResult } from './anthropic';
import { dbCtx, insertTurns, resetTables } from '../test/helpers';

const FAKE_SUMMARY = 'INTEGRATED NARRATIVE: student covered the Columbian Exchange.';

function fakeClaude(
  content: string = FAKE_SUMMARY,
): CompactionDeps {
  return {
    callClaude: vi.fn(
      async (): Promise<ClaudeResult> => ({
        content,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    ),
  };
}

function throwingClaude(message = 'simulated upstream failure'): CompactionDeps {
  return {
    callClaude: vi.fn(async () => {
      throw new Error(message);
    }),
  };
}

async function countTurns(): Promise<number> {
  const row = await env.DB
    .prepare('SELECT COUNT(*) AS c FROM turns WHERE conversation_id = ?')
    .bind(CONVERSATION_ID)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

describe('compaction', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('is a no-op when turn count is at or below the threshold', async () => {
    await insertTurns(COMPACTION_TRIGGER_TURNS); // exactly 30; trigger is "> 30"
    const deps = fakeClaude();
    const compacted = await compactIfNeeded(env, CONVERSATION_ID, deps);
    expect(compacted).toBe(0);
    expect(deps.callClaude).not.toHaveBeenCalled();
    expect(await countTurns()).toBe(COMPACTION_TRIGGER_TURNS);
  });

  it('compacts the oldest BATCH_SIZE turns when the threshold is exceeded', async () => {
    const ids = await insertTurns(COMPACTION_TRIGGER_TURNS + 1); // 31 turns
    const deps = fakeClaude();
    const compacted = await compactIfNeeded(env, CONVERSATION_ID, deps);
    expect(compacted).toBe(COMPACTION_BATCH_SIZE);
    expect(deps.callClaude).toHaveBeenCalledOnce();
    expect(await countTurns()).toBe(COMPACTION_TRIGGER_TURNS + 1 - COMPACTION_BATCH_SIZE);

    // The oldest 10 ids are gone.
    const survivingRow = await env.DB
      .prepare('SELECT MIN(id) AS m FROM turns WHERE conversation_id = ?')
      .bind(CONVERSATION_ID)
      .first<{ m: number }>();
    expect(survivingRow?.m).toBe(ids[COMPACTION_BATCH_SIZE]!);
  });

  it('writes the merged summary to conversation_summary', async () => {
    await insertTurns(COMPACTION_TRIGGER_TURNS + 1);
    await compactIfNeeded(env, CONVERSATION_ID, fakeClaude('NEW MERGED SUMMARY TEXT'));
    const row = await env.DB
      .prepare('SELECT summary FROM conversation_summary WHERE conversation_id = ?')
      .bind(CONVERSATION_ID)
      .first<{ summary: string }>();
    expect(row?.summary).toBe('NEW MERGED SUMMARY TEXT');
  });

  it('advances last_compacted_turn_id to the highest id in the compacted batch', async () => {
    const ids = await insertTurns(COMPACTION_TRIGGER_TURNS + 1);
    await compactIfNeeded(env, CONVERSATION_ID, fakeClaude());
    const row = await env.DB
      .prepare('SELECT last_compacted_turn_id FROM conversation_summary WHERE conversation_id = ?')
      .bind(CONVERSATION_ID)
      .first<{ last_compacted_turn_id: number }>();
    expect(row?.last_compacted_turn_id).toBe(ids[COMPACTION_BATCH_SIZE - 1]!);
  });

  it('removes the compacted turns from the turns table', async () => {
    const ids = await insertTurns(COMPACTION_TRIGGER_TURNS + 1);
    await compactIfNeeded(env, CONVERSATION_ID, fakeClaude());
    const compactedIds = ids.slice(0, COMPACTION_BATCH_SIZE);
    const row = await env.DB
      .prepare(
        `SELECT COUNT(*) AS c FROM turns WHERE conversation_id = ? AND id IN (${compactedIds.map(() => '?').join(',')})`,
      )
      .bind(CONVERSATION_ID, ...compactedIds)
      .first<{ c: number }>();
    expect(row?.c).toBe(0);
  });

  it('after compaction, loadRecentTurns no longer returns the compacted turns', async () => {
    const ids = await insertTurns(COMPACTION_TRIGGER_TURNS + 1);
    await compactIfNeeded(env, CONVERSATION_ID, fakeClaude());
    const recent = await loadRecentTurns(dbCtx(), CONVERSATION_ID, 100);
    const recentIds = new Set(recent.map((t) => t.id));
    for (let i = 0; i < COMPACTION_BATCH_SIZE; i++) {
      expect(recentIds.has(ids[i]!)).toBe(false);
    }
    expect(recent).toHaveLength(COMPACTION_TRIGGER_TURNS + 1 - COMPACTION_BATCH_SIZE);
  });

  it('does NOT delete any turns when the Claude call fails (atomicity)', async () => {
    await insertTurns(COMPACTION_TRIGGER_TURNS + 1);
    const before = await countTurns();
    await expect(
      compactIfNeeded(env, CONVERSATION_ID, throwingClaude()),
    ).rejects.toThrow(/simulated upstream failure/);

    expect(await countTurns()).toBe(before);
    const summaryRow = await env.DB
      .prepare('SELECT 1 AS x FROM conversation_summary WHERE conversation_id = ?')
      .bind(CONVERSATION_ID)
      .first<{ x: number }>();
    expect(summaryRow).toBeNull();
  });
});
