import { log } from './logger';
import { DatabaseError, ValidationError } from './errors';
import type { DbContext, TurnRow } from './db';
import type { ClaudeMessage } from './anthropic';
import {
  KnowledgeMapSchema,
  emptyKnowledgeMap,
  type KnowledgeMap,
} from '../types/knowledge-map';
import { MAX_RECENT_TURNS } from '../config';

/**
 * Memory layer.
 *
 * Stage 2 sent Claude "the last N turns and a placeholder system prompt".
 * Stage 3 replaces that with a layered memory model:
 *
 *     systemPrompt = base_prompt + knowledge_map + session_summary
 *     messages     = recent verbatim turns (oldest first), capped at MAX_RECENT_TURNS,
 *                    excluding any turns already folded into the summary.
 *
 * The functions in this file are the read/write surface for that model.
 * Stage 4's evaluation pass will be the primary writer of the knowledge map;
 * Stage 3 only provides storage + assembly so the loop is wired end to end.
 */

/** Loaded summary row. `last_compacted_turn_id` is null for fresh conversations. */
export interface ConversationSummary {
  summary: string;
  last_compacted_turn_id: number | null;
}

/** Assembled Claude input: split system prompt and message array. */
export interface ClaudeInput {
  systemPrompt: string;
  messages: ClaudeMessage[];
}

// ---------------------------------------------------------------------------
// Knowledge map
// ---------------------------------------------------------------------------

/**
 * Read the knowledge map for a conversation. Returns a fresh empty map (NOT
 * persisted) when no row exists. Throws DatabaseError when stored JSON is
 * unparseable or schema-invalid -- these indicate corruption, not a missing
 * map, and the caller shouldn't silently overwrite them.
 */
export async function loadKnowledgeMap(
  db: DbContext,
  conversationId: number,
): Promise<KnowledgeMap> {
  let row: { data: string } | null;
  try {
    row = await db.d1
      .prepare('SELECT data FROM knowledge_map WHERE conversation_id = ?')
      .bind(conversationId)
      .first<{ data: string }>();
  } catch (err) {
    log.error('knowledge_map_select_failed', { conversationId, error: err });
    throw new DatabaseError('failed to load knowledge map');
  }
  if (row === null) return emptyKnowledgeMap();

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.data);
  } catch (err) {
    log.error('knowledge_map_parse_failed', { conversationId, error: err });
    throw new DatabaseError('stored knowledge map is not valid JSON');
  }
  const validated = KnowledgeMapSchema.safeParse(parsed);
  if (!validated.success) {
    log.error('knowledge_map_invalid', {
      conversationId,
      issues: validated.error.issues,
    });
    throw new DatabaseError('stored knowledge map failed validation');
  }
  return validated.data;
}

/**
 * Persist the knowledge map for a conversation. Validates against the Zod
 * schema before write -- a malformed map is the caller's bug, not a runtime
 * condition, so we throw ValidationError (400) rather than DatabaseError.
 */
export async function saveKnowledgeMap(
  db: DbContext,
  conversationId: number,
  map: KnowledgeMap,
): Promise<void> {
  const validated = KnowledgeMapSchema.safeParse(map);
  if (!validated.success) {
    throw new ValidationError('invalid knowledge map', validated.error.issues);
  }
  const data = JSON.stringify(map);
  const now = Date.now();
  try {
    await db.d1
      .prepare(
        `INSERT INTO knowledge_map (conversation_id, data, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET
           data = excluded.data,
           updated_at = excluded.updated_at`,
      )
      .bind(conversationId, data, now)
      .run();
  } catch (err) {
    log.error('knowledge_map_save_failed', { conversationId, error: err });
    throw new DatabaseError('failed to save knowledge map');
  }
}

// ---------------------------------------------------------------------------
// Conversation summary
// ---------------------------------------------------------------------------

/** Read the running summary. Returns `{summary:'', last_compacted_turn_id:null}` if absent. */
export async function loadSummary(
  db: DbContext,
  conversationId: number,
): Promise<ConversationSummary> {
  try {
    const row = await db.d1
      .prepare(
        'SELECT summary, last_compacted_turn_id FROM conversation_summary WHERE conversation_id = ?',
      )
      .bind(conversationId)
      .first<{ summary: string; last_compacted_turn_id: number | null }>();
    if (row === null) return { summary: '', last_compacted_turn_id: null };
    return { summary: row.summary, last_compacted_turn_id: row.last_compacted_turn_id };
  } catch (err) {
    log.error('summary_load_failed', { conversationId, error: err });
    throw new DatabaseError('failed to load conversation summary');
  }
}

// ---------------------------------------------------------------------------
// Recent turns (verbatim window)
// ---------------------------------------------------------------------------

/**
 * Load the most recent `limit` turns above the compaction watermark, returned
 * oldest-first (chronological). Turns with id <= last_compacted_turn_id are
 * excluded -- they're already represented in the summary.
 */
export async function loadRecentTurns(
  db: DbContext,
  conversationId: number,
  limit: number = MAX_RECENT_TURNS,
): Promise<TurnRow[]> {
  const summary = await loadSummary(db, conversationId);
  const watermark = summary.last_compacted_turn_id ?? 0;
  try {
    const result = await db.d1
      .prepare(
        `SELECT id, conversation_id, role, content, created_at
         FROM turns
         WHERE conversation_id = ? AND id > ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(conversationId, watermark, limit)
      .all<TurnRow>();
    if (!result.success) {
      log.error('recent_turns_select_failed', { conversationId, error: result.error ?? null });
      throw new DatabaseError('failed to load recent turns');
    }
    return [...(result.results ?? [])].reverse();
  } catch (err) {
    if (err instanceof DatabaseError) throw err;
    log.error('recent_turns_threw', { conversationId, error: err });
    throw new DatabaseError('failed to load recent turns');
  }
}

// ---------------------------------------------------------------------------
// Claude input assembly
// ---------------------------------------------------------------------------

/**
 * Build the full Claude input for a chat turn.
 *
 * The system prompt is composed of three demarcated XML-style sections:
 *
 *     <base_prompt>...</base_prompt>
 *     <knowledge_map>... JSON ...</knowledge_map>
 *     <session_summary>...</session_summary>   <-- omitted when summary is empty
 *
 * Demarcation lets the model treat each block as structured context rather
 * than blending it into instructions; XML-ish tags work well per Anthropic's
 * prompting guide.
 *
 * The `messages` array contains the verbatim recent turns, oldest-first,
 * mapped to {role, content}. A leading-assistant turn (only possible if a
 * future change to compaction batches an odd number) is dropped so Claude's
 * "messages must start with user" rule still holds.
 */
export async function buildClaudeInput(
  db: DbContext,
  conversationId: number,
  basePrompt: string,
): Promise<ClaudeInput> {
  const [map, summary, turns] = await Promise.all([
    loadKnowledgeMap(db, conversationId),
    loadSummary(db, conversationId),
    loadRecentTurns(db, conversationId, MAX_RECENT_TURNS),
  ]);

  const sections: string[] = [
    `<base_prompt>\n${basePrompt}\n</base_prompt>`,
    `<knowledge_map>\n${JSON.stringify(map, null, 2)}\n</knowledge_map>`,
  ];
  if (summary.summary.length > 0) {
    sections.push(`<session_summary>\n${summary.summary}\n</session_summary>`);
  }
  const systemPrompt = sections.join('\n\n');

  const messages: ClaudeMessage[] = turns.map((t) => ({ role: t.role, content: t.content }));
  while (messages.length > 0 && messages[0]!.role !== 'user') {
    messages.shift();
  }

  return { systemPrompt, messages };
}
