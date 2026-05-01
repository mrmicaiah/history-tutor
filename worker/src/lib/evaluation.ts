import type { Env } from '../env';
import { log } from './logger';
import { withDb } from './db';
import {
  loadKnowledgeMap,
  loadRecentTurns,
  saveKnowledgeMap,
} from './memory';
import { mergeEvaluation } from './map-merge';
import { getTurnEvaluation, upsertTurnMetadata } from './turn-metadata';
import {
  callClaude as defaultCallClaude,
  type CallClaudeParams,
  type ClaudeResult,
} from './anthropic';
import {
  EVALUATION_CONTEXT_TURNS,
  EVALUATION_MODEL,
  MAX_OUTPUT_TOKENS_EVALUATION,
} from '../config';
import {
  EVALUATION_SYSTEM_PROMPT,
  buildEvaluationUserMessage,
} from '../prompts/evaluation';
import {
  EvaluationResultSchema,
  type EvaluationResult,
} from '../types/evaluation';
import type { KnowledgeMap } from '../types/knowledge-map';
import type { TurnRow } from './db';

/**
 * Evaluation pass orchestrator.
 *
 * Called from `ctx.waitUntil()` after each chat turn (the user-turn id is
 * the one being evaluated). Best-effort: any internal failure is logged and
 * swallowed so the chat flow stays unaffected.
 *
 * Idempotent: if `turn_metadata.evaluation` is already populated for this
 * turn, the function returns early. This protects against double-runs from
 * retries or accidental schedules without double-applying merges to the map.
 *
 * `callClaude` is dependency-injected so future test paths can stub it
 * cheaply (the spec didn't ask for eval integration tests in Stage 4 because
 * mocking Claude here mostly tests the mock; the merge logic is unit-tested
 * separately in `map-merge.test.ts`).
 */

export interface EvaluationDeps {
  callClaude: (params: CallClaudeParams) => Promise<ClaudeResult>;
}

const DEFAULT_DEPS: EvaluationDeps = { callClaude: defaultCallClaude };

/** Returns the merged map if eval ran, or `null` on skip / parse failure / unrecoverable error. */
export async function runEvaluation(
  env: Env,
  conversationId: number,
  studentTurnId: number,
  deps: EvaluationDeps = DEFAULT_DEPS,
): Promise<KnowledgeMap | null> {
  return withDb(env, async (db) => {
    try {
      const alreadyEvaluated = await getTurnEvaluation(db, studentTurnId);
      if (alreadyEvaluated !== null) {
        return null;
      }

      const currentMap = await loadKnowledgeMap(db, conversationId);
      const turns = await loadRecentTurns(db, conversationId, EVALUATION_CONTEXT_TURNS);
      const studentTurn = turns.find((t) => t.id === studentTurnId);
      if (studentTurn === undefined) {
        log.warn('evaluation_student_turn_missing', { conversationId, studentTurnId });
        return null;
      }

      const userMessage = buildEvaluationUserMessage({
        knowledgeMapJson: JSON.stringify(currentMap),
        recentTurnsText: formatTurnsForEval(turns),
        studentTurnContent: studentTurn.content,
      });

      const result = await deps.callClaude({
        apiKey: env.ANTHROPIC_API_KEY,
        model: EVALUATION_MODEL,
        systemPrompt: EVALUATION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: MAX_OUTPUT_TOKENS_EVALUATION,
      });

      const evalResult = parseEvaluationResponse(result.content);
      if (evalResult === null) {
        return null;
      }

      const merged = mergeEvaluation(currentMap, evalResult, studentTurnId);
      await saveKnowledgeMap(db, conversationId, merged);
      await upsertTurnMetadata(db, studentTurnId, {
        evaluation: JSON.stringify(evalResult),
      });

      log.info('evaluation_completed', {
        conversationId,
        studentTurnId,
        facts_demonstrated: evalResult.facts_demonstrated.length,
        misconceptions_observed: evalResult.misconceptions_observed.length,
        misconceptions_addressed: evalResult.misconceptions_addressed.length,
        skills_observed: evalResult.skills_observed.length,
      });
      return merged;
    } catch (err) {
      log.error('evaluation_unrecoverable', { conversationId, studentTurnId, error: err });
      return null;
    }
  });
}

/** Render the verbatim turn window as `Student: ...\n\nTutor: ...` blocks. */
function formatTurnsForEval(turns: ReadonlyArray<TurnRow>): string {
  return turns
    .map((t) => `${t.role === 'user' ? 'Student' : 'Tutor'}: ${t.content}`)
    .join('\n\n');
}

/**
 * Parse Claude's JSON response. Tolerates accidental ```json fences. Returns
 * null on any failure (parse error or schema validation), having logged a
 * truncated snippet so the failure is diagnosable from `wrangler tail`.
 */
function parseEvaluationResponse(raw: string): EvaluationResult | null {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    log.warn('evaluation_json_parse_failed', {
      error: err,
      snippet: text.slice(0, 300),
    });
    return null;
  }

  const validated = EvaluationResultSchema.safeParse(parsed);
  if (!validated.success) {
    log.warn('evaluation_zod_validation_failed', {
      issues: validated.error.issues,
      snippet: text.slice(0, 300),
    });
    return null;
  }
  return validated.data;
}
