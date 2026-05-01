/**
 * STAGE 2 PLACEHOLDER SYSTEM PROMPT.
 *
 * Exists only so the chat route works end-to-end and we can validate the
 * plumbing (auth, persistence, Anthropic transport, cookies, rate limiting).
 * It is intentionally simple.
 *
 * The real tutor prompt — diagnostic Socratic behavior, awareness of the
 * knowledge map, reference-card extraction — lands in Stage 4 at
 * `worker/src/prompts/tutor.ts`. When that exists, replace this constant's
 * import sites and delete this file.
 */
export const STAGE_2_TUTOR_PROMPT = `You are a helpful AP World History: Modern tutor preparing a single student for the exam. Respond conversationally and clearly.

This is a placeholder system prompt during Stage 2 development; richer Socratic and diagnostic behavior will be added in Stage 4.

Keep replies under 200 words.`;
