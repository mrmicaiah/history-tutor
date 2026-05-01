import { z } from 'zod';
import type { Env } from '../env';
import { json } from '../lib/responses';
import { ValidationError } from '../lib/errors';
import { requireAuth } from '../lib/auth';
import { withDb } from '../lib/db';
import { CONVERSATION_ID } from '../config';
import { CARD_CATEGORIES } from '../types/curriculum';

/**
 * GET /api/cards
 *
 * Paginated list of reference cards for the conversation. Sortable by
 * `weakest` (mastery ASC), `newest` (created_at DESC), or `alpha`
 * (term COLLATE NOCASE ASC). Filter by `category` and/or `era`.
 *
 * The Stage 5 frontend will surface these in the review panel; the
 * weakest-first default mirrors how spaced-repetition tools tend to drive
 * attention.
 */

/** Sort modes -> ORDER BY clauses. Keys are the only allowed user input. */
const SORT_CLAUSES = {
  weakest: 'mastery ASC, created_at DESC',
  newest: 'created_at DESC',
  alpha: 'term COLLATE NOCASE ASC',
} as const satisfies Record<string, string>;
type SortMode = keyof typeof SORT_CLAUSES;

const CardsQuerySchema = z.object({
  sort: z.enum(['weakest', 'newest', 'alpha'] as const).default('weakest'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  category: z.enum(CARD_CATEGORIES).optional(),
  era: z.string().min(1).max(64).optional(),
});

interface CardRow {
  id: number;
  term: string;
  category: string;
  definition: string;
  era: string | null;
  theme: string | null;
  times_reviewed: number;
  mastery: number;
  created_at: number;
  updated_at: number;
}

export async function handleCards(req: Request, env: Env): Promise<Response> {
  await requireAuth(req, env);

  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams);
  const parsed = CardsQuerySchema.safeParse(params);
  if (!parsed.success) {
    throw new ValidationError('invalid cards query', parsed.error.issues);
  }
  const { sort, limit, offset, category, era } = parsed.data;

  return withDb(env, async (db) => {
    const conditions: string[] = ['conversation_id = ?'];
    const values: unknown[] = [CONVERSATION_ID];
    if (category !== undefined) {
      conditions.push('category = ?');
      values.push(category);
    }
    if (era !== undefined) {
      conditions.push('era = ?');
      values.push(era);
    }
    const whereClause = conditions.join(' AND ');
    const orderClause = SORT_CLAUSES[sort as SortMode];

    const totalRow = await db.d1
      .prepare(`SELECT COUNT(*) AS c FROM reference_cards WHERE ${whereClause}`)
      .bind(...values)
      .first<{ c: number }>();
    const total = totalRow?.c ?? 0;

    const cardsResult = await db.d1
      .prepare(
        `SELECT id, term, category, definition, era, theme,
                times_reviewed, mastery, created_at, updated_at
         FROM reference_cards
         WHERE ${whereClause}
         ORDER BY ${orderClause}
         LIMIT ? OFFSET ?`,
      )
      .bind(...values, limit, offset)
      .all<CardRow>();
    const cards = cardsResult.results ?? [];

    return json({
      cards,
      total,
      has_more: offset + cards.length < total,
    });
  });
}
