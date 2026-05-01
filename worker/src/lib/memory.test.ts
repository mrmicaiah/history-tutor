import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import {
  buildClaudeInput,
  loadKnowledgeMap,
  loadRecentTurns,
  loadSummary,
  saveKnowledgeMap,
} from './memory';
import { ValidationError } from './errors';
import {
  emptyKnowledgeMap,
  type KnowledgeMap,
} from '../types/knowledge-map';
import { CONVERSATION_ID } from '../config';
import { dbCtx, insertTurn, resetTables } from '../test/helpers';

describe('memory', () => {
  beforeEach(async () => {
    await resetTables();
  });

  // -------------------------------------------------------------------------
  // Knowledge map
  // -------------------------------------------------------------------------

  it('loadKnowledgeMap returns a valid empty map when none exists', async () => {
    const map = await loadKnowledgeMap(dbCtx(), CONVERSATION_ID);
    expect(map.version).toBe(1);
    expect(map.diagnostic_notes).toBe('');
    expect(map.known_facts).toEqual([]);
    expect(map.misconceptions).toEqual([]);
    expect(Object.keys(map.era_competence)).toHaveLength(9);
    expect(Object.values(map.era_competence).every((v) => v === 'untested')).toBe(true);
    expect(Object.keys(map.theme_competence)).toHaveLength(6);
  });

  it('saveKnowledgeMap rejects an invalid map (Zod validation)', async () => {
    const broken = { ...emptyKnowledgeMap(), version: 2 } as unknown as KnowledgeMap;
    await expect(saveKnowledgeMap(dbCtx(), CONVERSATION_ID, broken)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('saveKnowledgeMap + loadKnowledgeMap round-trips correctly', async () => {
    const map = emptyKnowledgeMap(1_700_000_000_000);
    map.diagnostic_notes = 'Strong on 1450-1750 trade routes; shaky on Cold War.';
    map.weak_areas = ['Mongol succession', 'Treaty of Versailles consequences'];
    map.known_facts = [
      {
        fact: 'The Columbian Exchange transferred maize and potatoes to Afro-Eurasia.',
        first_demonstrated_turn_id: 4,
        last_confirmed_turn_id: 12,
        strength: 2,
      },
    ];
    map.era_competence['transoceanic'] = 'familiar';

    await saveKnowledgeMap(dbCtx(), CONVERSATION_ID, map);
    const loaded = await loadKnowledgeMap(dbCtx(), CONVERSATION_ID);

    expect(loaded).toEqual(map);
  });

  // -------------------------------------------------------------------------
  // Recent turns / watermark
  // -------------------------------------------------------------------------

  it('loadRecentTurns excludes turns with id <= last_compacted_turn_id', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await insertTurn(CONVERSATION_ID, i % 2 === 0 ? 'user' : 'assistant', `t${i}`, 1_700_000_000_000 + i));
    }
    // Mark the 3rd turn as the watermark.
    await env.DB
      .prepare(
        `INSERT INTO conversation_summary (conversation_id, summary, last_compacted_turn_id, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(CONVERSATION_ID, 'prior summary', ids[2]!, Date.now())
      .run();

    const recent = await loadRecentTurns(dbCtx(), CONVERSATION_ID, 50);
    const recentIds = recent.map((t) => t.id);
    expect(recentIds).toEqual([ids[3]!, ids[4]!]);
  });

  it('loadRecentTurns returns oldest first', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(await insertTurn(CONVERSATION_ID, i % 2 === 0 ? 'user' : 'assistant', `t${i}`, 1_700_000_000_000 + i));
    }
    const recent = await loadRecentTurns(dbCtx(), CONVERSATION_ID, 50);
    expect(recent.map((t) => t.id)).toEqual(ids);
  });

  // -------------------------------------------------------------------------
  // buildClaudeInput
  // -------------------------------------------------------------------------

  it('buildClaudeInput injects the knowledge map JSON into the system prompt', async () => {
    await insertTurn(CONVERSATION_ID, 'user', 'hi', 1_700_000_000_000);
    const { systemPrompt } = await buildClaudeInput(dbCtx(), CONVERSATION_ID, 'BASE');
    expect(systemPrompt).toContain('<base_prompt>\nBASE\n</base_prompt>');
    expect(systemPrompt).toContain('<knowledge_map>');
    // Spot-check that the JSON inside is recognizable as our map.
    expect(systemPrompt).toContain('"version": 1');
    expect(systemPrompt).toContain('"era_competence"');
    expect(systemPrompt).toContain('"diagnostic_notes"');
  });

  it('buildClaudeInput injects the summary when present', async () => {
    await insertTurn(CONVERSATION_ID, 'user', 'hi', 1_700_000_000_000);
    await env.DB
      .prepare(
        `INSERT INTO conversation_summary (conversation_id, summary, last_compacted_turn_id, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(CONVERSATION_ID, 'STUDENT KNOWS X', null, Date.now())
      .run();
    const { systemPrompt } = await buildClaudeInput(dbCtx(), CONVERSATION_ID, 'BASE');
    expect(systemPrompt).toContain('<session_summary>\nSTUDENT KNOWS X\n</session_summary>');
  });

  it('buildClaudeInput omits the summary block when summary is empty', async () => {
    await insertTurn(CONVERSATION_ID, 'user', 'hi', 1_700_000_000_000);
    const { systemPrompt } = await buildClaudeInput(dbCtx(), CONVERSATION_ID, 'BASE');
    expect(systemPrompt).not.toContain('<session_summary>');
  });

  it("buildClaudeInput's messages array ends with the most recent user turn", async () => {
    await insertTurn(CONVERSATION_ID, 'user', 'first user', 1_700_000_000_001);
    await insertTurn(CONVERSATION_ID, 'assistant', 'reply', 1_700_000_000_002);
    await insertTurn(CONVERSATION_ID, 'user', 'newest user', 1_700_000_000_003);

    const { messages } = await buildClaudeInput(dbCtx(), CONVERSATION_ID, 'BASE');
    expect(messages).toHaveLength(3);
    const last = messages[messages.length - 1]!;
    expect(last.role).toBe('user');
    expect(last.content).toBe('newest user');
    // And as a sanity check, the array starts with a user turn (Anthropic requires this).
    expect(messages[0]!.role).toBe('user');
  });

  it('loadSummary returns empty defaults when no row exists', async () => {
    const s = await loadSummary(dbCtx(), CONVERSATION_ID);
    expect(s.summary).toBe('');
    expect(s.last_compacted_turn_id).toBeNull();
  });
});
