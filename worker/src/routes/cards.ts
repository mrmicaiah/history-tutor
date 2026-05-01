import type { Env } from '../env';
import { json, errorResponse } from '../lib/responses';
import { ValidationError } from '../lib/errors';
import { requireAuth } from '../lib/auth';
import { withDb } from '../lib/db';
import { CardPatchSchema, CardsQuerySchema } from '../schemas';
import { CONVERSATION_ID } from '../config';
import type { ReferenceCard } from '../types/cards';

/**
 * Reference cards API.
 *
 *   GET    /api/cards         — list (sortable, filterable, paginated)
 *   PATCH  /api/cards/:id     — student self-rates mastery (0..5)
 *
 * Both endpoints require auth. Card mastery and times_reviewed bookkeeping
 * is the only writer to a card row outside `lib/cards.persistCards` (which
 * is the tutor-flagged path during chat).
 */

const SORT_CLAUSES = {
  weakest: 'mastery ASC, created_at DESC',
  newest: 'created_at DESC',
  alpha: 'term COLLATE NOCASE ASC',
} as const satisfies Record<string, string>;
type SortMode = keyof typeof SORT_CLAUSES;

const CARD_COLUMNS = `id, term, category, definition, era, theme,
                      times_reviewed, mastery, created_at, updated_at`;

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
        `SELECT ${CARD_COLUMNS}
         FROM reference_cards
         WHERE ${whereClause}
         ORDER BY ${orderClause}
         LIMIT ? OFFSET ?`,
      )
      .bind(...values, limit, offset)
      .all<ReferenceCard>();
    const cards = cardsResult.results ?? [];

    return json({
      cards,
      total,
      has_more: offset + cards.length < total,
    });
  });
}

/**
 * PATCH /api/cards/:id
 *
 * Body: `{ mastery: 0..5 }`. Increments `times_reviewed` (every PATCH counts
 * as a review event) and writes the new mastery. Returns the updated row,
 * or 404 if no card with that id belongs to the conversation.
 */
export async function handleCardPatch(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
  pathParams: Record<string, string>,
): Promise<Response> {
  await requireAuth(req, env);

  const idStr = pathParams.id ?? '';
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError('invalid card id');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('invalid JSON body');
  }
  const parsed = CardPatchSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('invalid card patch', parsed.error.issues);
  }

  return withDb(env, async (db) => {
    const now = Date.now();
    const result = await db.d1
      .prepare(
        `UPDATE reference_cards
         SET mastery = ?, times_reviewed = times_reviewed + 1, updated_at = ?
         WHERE id = ? AND conversation_id = ?
         RETURNING ${CARD_COLUMNS}`,
      )
      .bind(parsed.data.mastery, now, id, CONVERSATION_ID)
      .first<ReferenceCard>();

    if (result === null) {
      return errorResponse(404, 'card_not_found');
    }
    return json({ card: result });
  });
}
