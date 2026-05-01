import { log } from './logger';
import { DatabaseError } from './errors';
import type { DbContext } from './db';
import { CARD_CATEGORIES, type CardCategory } from '../types/curriculum';
import { MAX_CARDS_PER_MESSAGE } from '../config';

/**
 * Reference card extraction + persistence.
 *
 * Cards are flagged by the tutor at the end of an assistant message in a
 * `<cards>...</cards>` block (see `prompts/tutor.ts`). Each line is
 * `[[term | category | definition | era | theme]]`. This module:
 *
 *   - parses the block out of the raw reply (`extractCards`),
 *   - returns the user-visible reply with the block stripped, and
 *   - persists the parsed cards into `reference_cards` with de-duplication
 *     keyed on `(conversation_id, term)` (`persistCards`).
 *
 * All card writes happen inside one `db.batch()` to avoid N round trips when
 * the tutor flags multiple cards in a single turn.
 */

export interface ParsedCard {
  term: string;
  category: CardCategory;
  definition: string;
  era: string | null;
  theme: string | null;
}

const CARDS_BLOCK_RE = /<cards>([\s\S]*?)<\/cards>\s*$/;
const CARD_LINE_RE = /^\s*\[\[(.+?)\]\]\s*$/;

/**
 * Split a tutor reply into the user-visible portion and the parsed card
 * list. The cards block, if present, is stripped from the visible reply.
 *
 * Tolerates malformed lines (logs a warning, skips the line). Hard-caps at
 * `MAX_CARDS_PER_MESSAGE`; surplus cards are dropped with a warning.
 */
export function extractCards(rawReply: string): {
  visibleReply: string;
  cards: ParsedCard[];
} {
  const match = CARDS_BLOCK_RE.exec(rawReply);
  if (!match) {
    return { visibleReply: rawReply.trim(), cards: [] };
  }

  const visibleReply = rawReply.slice(0, match.index).trim();
  const block = match[1] ?? '';

  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const cards: ParsedCard[] = [];
  for (const line of lines) {
    const parsed = parseCardLine(line);
    if (parsed !== null) cards.push(parsed);
  }

  if (cards.length > MAX_CARDS_PER_MESSAGE) {
    log.warn('cards_capped', { extracted: cards.length, cap: MAX_CARDS_PER_MESSAGE });
    return { visibleReply, cards: cards.slice(0, MAX_CARDS_PER_MESSAGE) };
  }
  return { visibleReply, cards };
}

function parseCardLine(line: string): ParsedCard | null {
  const lineMatch = CARD_LINE_RE.exec(line);
  if (!lineMatch) {
    log.warn('card_line_malformed', { line });
    return null;
  }
  const inner = lineMatch[1] ?? '';
  const parts = inner.split('|').map((p) => p.trim());
  const term = parts[0] ?? '';
  const category = parts[1] ?? '';
  const definition = parts[2] ?? '';
  const era = parts[3] ?? '';
  const theme = parts[4] ?? '';

  if (term.length === 0 || definition.length === 0 || category.length === 0) {
    log.warn('card_required_field_missing', { line });
    return null;
  }
  if (!isCardCategory(category)) {
    log.warn('card_invalid_category', { line, category });
    return null;
  }
  return {
    term,
    category,
    definition,
    era: era.length > 0 ? era : null,
    theme: theme.length > 0 ? theme : null,
  };
}

function isCardCategory(value: string): value is CardCategory {
  return (CARD_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Persist parsed cards. For each card:
 *   - If `(conversation_id, term)` already exists, update its `definition`,
 *     bump `updated_at`, and increment `times_reviewed`.
 *   - Otherwise insert a new row with `times_reviewed = 0`, `mastery = 0`.
 *
 * Returns counts so the chat handler can log card creation pressure.
 */
export async function persistCards(
  db: DbContext,
  conversationId: number,
  turnId: number,
  cards: ParsedCard[],
): Promise<{ created: number; updated: number }> {
  if (cards.length === 0) return { created: 0, updated: 0 };

  const placeholders = cards.map(() => '?').join(',');
  let existingTerms: Set<string>;
  try {
    const existing = await db.d1
      .prepare(
        `SELECT term FROM reference_cards
         WHERE conversation_id = ? AND term IN (${placeholders})`,
      )
      .bind(conversationId, ...cards.map((c) => c.term))
      .all<{ term: string }>();
    existingTerms = new Set(existing.results?.map((r) => r.term) ?? []);
  } catch (err) {
    log.error('cards_select_existing_failed', { conversationId, error: err });
    throw new DatabaseError('failed to load existing cards');
  }

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  let created = 0;
  let updated = 0;

  for (const card of cards) {
    if (existingTerms.has(card.term)) {
      statements.push(
        db.d1
          .prepare(
            `UPDATE reference_cards
             SET definition = ?, updated_at = ?, times_reviewed = times_reviewed + 1
             WHERE conversation_id = ? AND term = ?`,
          )
          .bind(card.definition, now, conversationId, card.term),
      );
      updated++;
    } else {
      statements.push(
        db.d1
          .prepare(
            `INSERT INTO reference_cards (
               conversation_id, term, category, definition, era, theme,
               first_seen_turn_id, times_reviewed, mastery, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
          )
          .bind(
            conversationId,
            card.term,
            card.category,
            card.definition,
            card.era,
            card.theme,
            turnId,
            now,
            now,
          ),
      );
      created++;
    }
  }

  try {
    await db.d1.batch(statements);
  } catch (err) {
    log.error('cards_batch_failed', { conversationId, error: err });
    throw new DatabaseError('failed to persist cards');
  }
  return { created, updated };
}
