import type { Env } from '../env';
import { json } from '../lib/responses';
import { ValidationError } from '../lib/errors';
import { ChatRequestSchema } from '../schemas';
import { requireAuth } from '../lib/auth';
import {
  insertTurn,
  touchConversation,
  withDb,
} from '../lib/db';
import { checkRateLimit } from '../lib/rate-limit';
import { callClaude } from '../lib/anthropic';
import {
  buildClaudeInput,
  loadKnowledgeMap,
  loadSummary,
} from '../lib/memory';
import { compactIfNeeded } from '../lib/compaction';
import { runEvaluation } from '../lib/evaluation';
import { extractCards, persistCards } from '../lib/cards';
import { upsertTurnMetadata } from '../lib/turn-metadata';
import { buildTutorSystemPrompt } from '../prompts/tutor';
import {
  CLAUDE_MODEL,
  CONVERSATION_ID,
  MAX_OUTPUT_TOKENS_CHAT,
  RATE_LIMIT_CHAT_PER_MIN,
  RATE_LIMIT_CHAT_WINDOW_S,
} from '../config';
import { log } from '../lib/logger';

/**
 * POST /api/chat
 *
 * Body: { message: string }
 * Success: 200 { reply: string }
 *
 * Stage 4 flow:
 *   1. Auth + body validation.
 *   2. withDb:
 *      a. Rate-limit.
 *      b. Insert user turn.
 *      c. Build the real tutor system prompt (Stage 4) with today's date
 *         and a session-context cue, then wrap with knowledge_map +
 *         session_summary blocks via `buildClaudeInput`.
 *      d. Call Claude (tutor model).
 *      e. Strip the trailing `<cards>...</cards>` block; insert the
 *         user-visible portion as the assistant turn; persist any cards.
 *      f. Persist token counts to `turn_metadata`
 *         (input on user-turn row, output on assistant-turn row).
 *      g. Touch conversation.updated_at.
 *   3. Schedule the eval pass and compaction via `ctx.waitUntil` — both
 *      are best-effort; failures are logged but never break the response.
 *   4. Return the visible reply.
 */
export async function handleChat(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  await requireAuth(req, env);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('invalid JSON body');
  }
  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('invalid chat request', parsed.error.issues);
  }
  const { message } = parsed.data;

  const result = await withDb(env, async (db) => {
    await checkRateLimit(db, 'chat', RATE_LIMIT_CHAT_PER_MIN, RATE_LIMIT_CHAT_WINDOW_S);

    const userTurnId = await insertTurn(db, CONVERSATION_ID, 'user', message);

    const map = await loadKnowledgeMap(db, CONVERSATION_ID);
    const summary = await loadSummary(db, CONVERSATION_ID);
    const tutorBase = buildTutorSystemPrompt({
      knowledgeMapJson: JSON.stringify(map),
      sessionSummary: summary.summary,
      todayIsoDate: new Date().toISOString().slice(0, 10),
    });
    const { systemPrompt, messages } = await buildClaudeInput(
      db,
      CONVERSATION_ID,
      tutorBase,
    );

    const claudeResult = await callClaude({
      apiKey: env.ANTHROPIC_API_KEY,
      model: CLAUDE_MODEL,
      systemPrompt,
      messages,
      maxTokens: MAX_OUTPUT_TOKENS_CHAT,
    });

    const { visibleReply, cards } = extractCards(claudeResult.content);
    const assistantTurnId = await insertTurn(
      db,
      CONVERSATION_ID,
      'assistant',
      visibleReply,
    );
    await touchConversation(db, CONVERSATION_ID);

    await upsertTurnMetadata(db, userTurnId, {
      input_tokens: claudeResult.usage.input_tokens,
      output_tokens: null,
    });
    await upsertTurnMetadata(db, assistantTurnId, {
      input_tokens: null,
      output_tokens: claudeResult.usage.output_tokens,
    });

    let cardCounts: { created: number; updated: number } = { created: 0, updated: 0 };
    if (cards.length > 0) {
      cardCounts = await persistCards(db, CONVERSATION_ID, assistantTurnId, cards);
    }

    log.info('chat_completed', {
      input_tokens: claudeResult.usage.input_tokens,
      output_tokens: claudeResult.usage.output_tokens,
      reply_chars: visibleReply.length,
      verbatim_turns_sent: messages.length,
      cards_created: cardCounts.created,
      cards_updated: cardCounts.updated,
    });

    return {
      response: json({ reply: visibleReply }),
      userTurnId,
    };
  });

  ctx.waitUntil(
    runEvaluation(env, CONVERSATION_ID, result.userTurnId).catch((err) => {
      log.error('evaluation_background_failed', { error: err });
    }),
  );
  ctx.waitUntil(
    compactIfNeeded(env, CONVERSATION_ID).catch((err) => {
      log.warn('compaction_background_failed', { error: err });
    }),
  );

  return result.response;
}
