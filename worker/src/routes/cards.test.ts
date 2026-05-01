import { beforeEach, describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createSessionCookie } from '../lib/auth';
import { resetTables } from '../test/helpers';
import { CONVERSATION_ID } from '../config';
import type { ReferenceCard } from '../types/cards';

/**
 * PATCH /api/cards/:id integration tests.
 *
 * Goes through the real Worker entry via `SELF.fetch` so the auth middleware,
 * router, and CORS layer are all exercised. The session cookie is forged
 * using `createSessionCookie` with the test environment's SESSION_SECRET
 * (set in vitest.config.ts as 64 zeros).
 */

async function authedHeaders(): Promise<Record<string, string>> {
  const setCookieValue = await createSessionCookie(env.SESSION_SECRET);
  // Strip attributes; the Cookie request header is just `name=value`.
  const cookie = setCookieValue.split(';')[0]!;
  return {
    Cookie: cookie,
    'content-type': 'application/json',
  };
}

async function insertCard(): Promise<number> {
  const now = Date.now();
  const result = await env.DB
    .prepare(
      `INSERT INTO reference_cards (
         conversation_id, term, category, definition, era, theme,
         first_seen_turn_id, times_reviewed, mastery, created_at, updated_at
       ) VALUES (?, 'TestTerm', 'concept', 'Test definition', 'tapestry', 'governance', NULL, 0, 0, ?, ?)`,
    )
    .bind(CONVERSATION_ID, now, now)
    .run();
  const id = result.meta.last_row_id;
  if (typeof id !== 'number') throw new Error('insertCard: missing last_row_id');
  return id;
}

describe('PATCH /api/cards/:id', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('returns 401 without a session cookie', async () => {
    const response = await SELF.fetch('http://test.local/api/cards/1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mastery: 2 }),
    });
    expect(response.status).toBe(401);
  });

  it('returns 400 when mastery is out of range', async () => {
    const id = await insertCard();
    const response = await SELF.fetch(`http://test.local/api/cards/${id}`, {
      method: 'PATCH',
      headers: await authedHeaders(),
      body: JSON.stringify({ mastery: 99 }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('validation');
  });

  it('returns 404 when the card id does not exist', async () => {
    const response = await SELF.fetch('http://test.local/api/cards/9999', {
      method: 'PATCH',
      headers: await authedHeaders(),
      body: JSON.stringify({ mastery: 3 }),
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('card_not_found');
  });

  it('returns 200 and increments times_reviewed on a successful update', async () => {
    const id = await insertCard();
    const response = await SELF.fetch(`http://test.local/api/cards/${id}`, {
      method: 'PATCH',
      headers: await authedHeaders(),
      body: JSON.stringify({ mastery: 4 }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { card: ReferenceCard };
    expect(body.card.id).toBe(id);
    expect(body.card.mastery).toBe(4);
    expect(body.card.times_reviewed).toBe(1);

    // Verify persisted state.
    const row = await env.DB
      .prepare('SELECT mastery, times_reviewed FROM reference_cards WHERE id = ?')
      .bind(id)
      .first<{ mastery: number; times_reviewed: number }>();
    expect(row?.mastery).toBe(4);
    expect(row?.times_reviewed).toBe(1);
  });
});
