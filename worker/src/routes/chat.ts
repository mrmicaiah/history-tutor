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
import { buildClaudeInput } from '../lib/memory';
import { compactIfNeeded } from '../lib/compaction';
import {
  CLAUDE_MODEL,
  CONVERSATION_ID,
  MAX_OUTPUT_TOKENS_CHAT,
  RATE_LIMIT_CHAT_PER_MIN,
  RATE_LIMIT_CHAT_WINDOW_S,
} from '../config';
import { STAGE_2_TUTOR_PROMPT } from '../prompts/tutor-stage2';
import { log } from '../lib/logger';

/**
 * POST /api/chat
 *
 * Body: { message: string }
 * Success: 200 { reply: string }
 *
 * Flow:
 *   1. Auth check (cookie).
 *   2. Validate body.
 *   3. Open DB context: rate-limit -> insert user turn ->
 *      buildClaudeInput (knowledge map + summary + verbatim window) ->
 *      Claude call -> insert assistant turn -> bump conversation.updated_at.
 *   4. Schedule compaction via ctx.waitUntil (background, non-blocking).
 *   5. Return the assistant reply.
 *
 * Important ordering: the user turn is inserted BEFORE buildClaudeInput so
 * it appears as the last message in the assembled `messages` array (Claude
 * expects the new user turn at the tail).
 *
 * Errors are thrown as AppError subclasses; the central mapper produces
 * the response. Compaction failures are swallowed (logged at warn) so they
 * never affect the user-visible response -- the conversation is intact and
 * the next turn will retry.
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

  const response = await withDb(env, async (db) => {
    await checkRateLimit(db, 'chat', RATE_LIMIT_CHAT_PER_MIN, RATE_LIMIT_CHAT_WINDOW_S);

    await insertTurn(db, CONVERSATION_ID, 'user', message);
    const { systemPrompt, messages } = await buildClaudeInput(
      db,
      CONVERSATION_ID,
      STAGE_2_TUTOR_PROMPT,
    );

    const result = await callClaude({
      apiKey: env.ANTHROPIC_API_KEY,
      model: CLAUDE_MODEL,
      systemPrompt,
      messages,
      maxTokens: MAX_OUTPUT_TOKENS_CHAT,
    });

    await insertTurn(db, CONVERSATION_ID, 'assistant', result.content);
    await touchConversation(db, CONVERSATION_ID);

    log.info('chat_completed', {
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      reply_chars: result.content.length,
      verbatim_turns_sent: messages.length,
    });

    return json({ reply: result.content });
  });

  ctx.waitUntil(
    compactIfNeeded(env, CONVERSATION_ID).catch((err) => {
      log.warn('compaction_background_failed', { error: err });
    }),
  );

  return response;
}
