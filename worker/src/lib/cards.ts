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
 * As a defense-in-depth measure, `scrubVisibleReply` runs unconditionally
 * on every assistant reply before it's persisted or returned, removing any
 * stray markup (`<cards>` tags, `[[...]]` lines) that escaped extraction.
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

// Strict: well-formed <cards>...</cards> at end of message (allows trailing whitespace).
const CARDS_BLOCK_RE = /<cards>([\s\S]*?)<\/cards>\s*$/i;
// Lenient fallback: opening <cards> with no closing tag — strip from there to EOM.
const CARDS_OPEN_RE = /<cards>([\s\S]*)$/i;
const CARD_LINE_RE = /^\s*\[\[(.+?)\]\]\s*$/;

/**
 * Split a tutor reply into the user-visible portion and the parsed card
 * list. The cards block, if present, is stripped from the visible reply.
 *
 * Two-pass parser:
 *   1. Try the strict regex (well-formed block at end of message).
 *   2. If strict misses but an unclosed <cards> tag exists, strip from
 *      that tag to end-of-message and parse what's there leniently.
 *      This protects against the model forgetting the </cards> tag.
 *
 * Tolerates malformed lines (logs a warning, skips the line). Hard-caps at
 * `MAX_CARDS_PER_MESSAGE`; surplus cards are dropped with a warning.
 */
export function extractCards(rawReply: string): {
  visibleReply: string;
  cards: ParsedCard[];
} {
  // Pass 1: strict, end-anchored.
  let match: RegExpExecArray | null = CARDS_BLOCK_RE.exec(rawReply);
  let lenient = false;

  // Pass 2: lenient fallback for missing closing tag.
  if (!match) {
    match = CARDS_OPEN_RE.exec(rawReply);
    if (match) {
      lenient = true;
      log.warn('cards_unclosed_block', { reply_length: rawReply.length });
    }
  }

  if (!match) {
    return { visibleReply: rawReply.trim(), cards: [] };
  }

  const visibleReply = rawReply.slice(0, match.index).trim();
  let block = match[1] ?? '';
  // In lenient mode, the block may have a stray </cards> if the model placed
  // it but didn't close cleanly enough for the strict regex. Strip it.
  if (lenient) {
    block = block.replace(/<\/cards>[\s\S]*$/i, '');
  }

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

/**
 * Defense-in-depth: scrub any residual cards-block markup from a reply
 * before it's shown to the student. Runs after `extractCards` on every
 * assistant reply. If this function actually changes anything, it means
 * `extractCards` had a hole — log a warning so we can investigate.
 *
 * Removes:
 *   - stray <cards> or </cards> tags (case-insensitive)
 *   - stray [[...]] lines (the bracket markup)
 *   - excess blank lines left behind by the above
 */
export function scrubVisibleReply(reply: string): string {
  const before = reply;
  const scrubbed = reply
    .replace(/<\/?cards>/gi, '')
    .replace(/\[\[[^\]]*?\]\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (scrubbed !== before) {
    log.warn('cards_scrub_fired', {
      original_length: before.length,
      scrubbed_length: scrubbed.length,
    });
  }
  return scrubbed;
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
