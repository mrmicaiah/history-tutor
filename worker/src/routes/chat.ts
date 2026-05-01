import type { Env } from '../env';
import { json } from '../lib/responses';
import { ValidationError } from '../lib/errors';
import { ChatRequestSchema } from '../schemas';
import { requireAuth } from '../lib/auth';
import {
  getRecentTurns,
  insertTurn,
  touchConversation,
  withDb,
} from '../lib/db';
import { checkRateLimit } from '../lib/rate-limit';
import { callClaude } from '../lib/anthropic';
import {
  CLAUDE_MODEL,
  CONVERSATION_ID,
  MAX_OUTPUT_TOKENS_CHAT,
  MAX_RECENT_TURNS,
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
 *   2. Validate body (cheap; 8 KB cap).
 *   3. Open DB context: rate-limit -> insert user turn ->
 *      load recent turns (oldest first) -> Claude call ->
 *      insert assistant turn -> bump conversation.updated_at.
 *   4. Return the assistant reply.
 *
 * Errors are thrown as AppError subclasses; the central mapper produces
 * the response. Steps 2 and 3 are intentionally separated so rate-limited
 * requests still pay the cheap parse cost — keeps a single `withDb` block
 * without forcing two DB opens per call.
 */
export async function handleChat(req: Request, env: Env): Promise<Response> {
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

  return withDb(env, async (db) => {
    await checkRateLimit(db, 'chat', RATE_LIMIT_CHAT_PER_MIN, RATE_LIMIT_CHAT_WINDOW_S);

    await insertTurn(db, CONVERSATION_ID, 'user', message);
    const recent = await getRecentTurns(db, CONVERSATION_ID, MAX_RECENT_TURNS);

    const result = await callClaude({
      apiKey: env.ANTHROPIC_API_KEY,
      model: CLAUDE_MODEL,
      systemPrompt: STAGE_2_TUTOR_PROMPT,
      messages: recent.map((t) => ({ role: t.role, content: t.content })),
      maxTokens: MAX_OUTPUT_TOKENS_CHAT,
    });

    await insertTurn(db, CONVERSATION_ID, 'assistant', result.content);
    await touchConversation(db, CONVERSATION_ID);

    log.info('chat_completed', {
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      reply_chars: result.content.length,
    });

    return json({ reply: result.content });
  });
}
