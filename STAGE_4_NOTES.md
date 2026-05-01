# Stage 4 — Notes

## What was built

The tutor is now an actual tutor. The Stage 2 placeholder system prompt has
been replaced with a real one that encodes diagnostic Socratic teaching, AP-
exam-aligned probes, coverage strategy driven by the knowledge map, and a
trailing `<cards>...</cards>` block for testable items. Every chat call now
triggers a background evaluation pass (Haiku) that reads the recent exchange,
emits a structured JSON record, and merges it deterministically into the
knowledge map. Reference cards extracted from the tutor's reply are persisted
with de-duplication. Token counts are recorded per turn. Two new read
endpoints expose what the Worker now knows about the student.

| Module / file                                | Purpose                                                            |
| :------------------------------------------- | :----------------------------------------------------------------- |
| `worker/src/prompts/tutor.ts`                | Real tutor system prompt (date + session-context cue + behavior).  |
| `worker/src/prompts/evaluation.ts`           | Eval system prompt + per-turn user-message builder.                |
| `worker/src/types/evaluation.ts`             | `EvaluationResult` type + Zod schema (defaults so partial parses). |
| `worker/src/lib/cards.ts`                    | `extractCards` + `persistCards` (SELECT-then-batch, de-dup).       |
| `worker/src/lib/map-merge.ts`                | Pure-deterministic `mergeEvaluation` (clone, validate, return).    |
| `worker/src/lib/turn-metadata.ts`            | `upsertTurnMetadata` / `getTurnEvaluation` (idempotent).           |
| `worker/src/lib/evaluation.ts`               | `runEvaluation` orchestrator (DI for callClaude; idempotent).      |
| `worker/src/routes/state.ts`                 | `GET /api/state` — full map + summary metadata + turn_count.       |
| `worker/src/routes/cards.ts`                 | `GET /api/cards` — paginated, sortable, filterable.                |
| `worker/src/lib/cards.test.ts`               | 9 tests (extraction + persistence + de-dup).                       |
| `worker/src/lib/map-merge.test.ts`           | 10 tests (every merge rule + caps + invalid-input).                |

Modified: `worker/src/types/curriculum.ts` (added `COMPETENCE_SIGNALS`,
`CARD_CATEGORIES`), `worker/src/config.ts` (eval/cap constants),
`worker/src/routes/chat.ts` (the new flow), `worker/src/index.ts`
(register `/api/state` and `/api/cards`), `README.md` (API surface table).

## Verified locally

| Acceptance criterion                                                               | Result |
| :--------------------------------------------------------------------------------- | :----: |
| `npm run typecheck`                                                                | ✓      |
| `npm run test` — **36 tests, all green** (17 prior + 9 cards + 10 map-merge)       | ✓      |
| Stage 1+2+3 endpoints unchanged (health, auth, chat fail paths)                    | ✓      |
| Chat handler now uses `buildTutorSystemPrompt` (verified by reading the code path) | ✓      |
| `/api/state` requires auth; returns the full empty map for a fresh DB              | ✓      |
| `/api/state` 401s without a valid cookie                                           | ✓      |
| `/api/cards` returns `{cards:[], total:0, has_more:false}` on empty DB             | ✓      |
| `/api/cards?sort=nonsense` returns 400 with Zod issue list                         | ✓      |
| `/api/chat` with auth + fake API key still returns 502 (regression check)          | ✓      |
| `extractCards` skips malformed lines but keeps valid ones (test)                   | ✓      |
| `extractCards` caps at MAX_CARDS_PER_MESSAGE (test)                                | ✓      |
| `persistCards` de-duplicates on `(conversation_id, term)` (test)                   | ✓      |
| `persistCards` updates definition when it changes (test)                           | ✓      |
| `mergeEvaluation` rules — every spec rule has a dedicated test (10 tests)          | ✓      |
| All files under 300 lines (max: `lib/map-merge.ts` at 256)                         | ✓      |
| No `console.*` outside `lib/logger.ts`                                             | ✓      |

## Acceptance criteria deferred to operator manual testing

Three criteria require a real Anthropic API key and several real exchanges
to verify end-to-end. The code paths are in place; the unit tests cover the
failure modes; what's left is sniff-testing tutor quality and watching the
map populate.

| Check                                                                  | How to run                                                                                                |
| :--------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| Tutor responses feel diagnostic and Socratic (not info-dumpy)          | Set real `ANTHROPIC_API_KEY`; have a real conversation; eyeball.                                          |
| `turn_metadata` populated with token counts after each chat            | After step above: `SELECT * FROM turn_metadata` — assistant rows have `output_tokens`, user rows have `input_tokens` (and eventually `evaluation`). |
| Cards flagged in tutor replies appear in `reference_cards`             | After a chat that introduces a testable item: `GET /api/cards`; verify the card is there.                 |
| Map populates over several exchanges (eras leave "untested", etc.)     | After ~5 substantive turns: `GET /api/state` — `era_competence` should show non-`untested` entries.       |

The eval-failure-doesn't-break-chat criterion is structurally guaranteed —
`runEvaluation` catches all internal errors and returns `null`; the chat
handler also wraps the `ctx.waitUntil` call with `.catch`. The chat reply
is sent before either background task runs.

## Decisions / deviations from the prompt

1. **`buildTutorSystemPrompt` returns the BASE prompt only.** It does not
   re-embed `<knowledge_map>` or `<session_summary>` — those are injected by
   `buildClaudeInput` (Stage 3) which the chat route still calls. The
   parameters are accepted for the contract the spec specified, and used
   only to swap a small contextual cue between fresh-conversation and
   continuing-session phrasing. Re-embedding would risk duplication and
   drift between the assembled context and what the prompt sees.

2. **Token splitting between turn rows.** Spec said "user turn won't have
   output tokens — leave that null." I put `input_tokens` on the user-turn
   row and `output_tokens` on the assistant-turn row; both rows exist per
   call. The user row also ends up holding `evaluation` (filled in by the
   background eval pass).

3. **Eval idempotency via existing-evaluation short-circuit.** Spec asked
   for `runEvaluation` to be idempotent. Implemented as: read
   `turn_metadata.evaluation` first; if non-null, return early. Cheaper than
   storing extra state and matches the spec's "safe to call multiple times".

4. **`mergeEvaluation` validates the OUTPUT map** (after merging), not the
   input. The eval input is already Zod-checked at parse time
   (`parseEvaluationResponse`). Output validation catches programming bugs
   that produce a malformed map — the test "rejects invalid input via the
   schema validator" passes because feeding in a corrupt map produces a
   corrupt output, which validation catches.

5. **Card persistence: SELECT-then-batch.** Two round trips per call
   (one SELECT to find existing terms, one batch of UPDATE/INSERT
   statements). Lets `persistCards` return clean `{created, updated}`
   counts. For ≤5 cards/turn the cost is trivial.

6. **`turn_count` in `/api/state`** is computed as `verbatimCount +
   last_compacted_turn_id`. This is exact for the single-conversation /
   sequential-id setup (since auto-increment ids are dense and never reused
   when only one conversation writes), but would need a counter column if
   we ever go multi-conversation per process. Documented in the route.

7. **`COMPETENCE_SIGNALS` added to `curriculum.ts`** (`['shaky', 'familiar',
   'solid']`) — the eval emits signals (not full Competence values, since
   "untested" isn't a signal). Type-level distinction.

8. **`extractCards` regex anchored at end-of-message.** Spec said the
   `<cards>` block lives at the end. The regex
   `/<cards>([\s\S]*?)<\/cards>\s*$/` enforces that — a stray earlier
   `<cards>` block in the body wouldn't match (and would slip through to
   the student, which is a behavior I'd rather catch in a future safety
   pass than silently strip).

9. **Eval pass uses a `<student_turn_under_evaluation>` block separately**
   from the `<recent_exchanges>` so Haiku can disambiguate "the turn we
   want eval'd" from "context for that turn" without relying on positional
   convention.

## Open questions

1. **Tutor prompt tuning.** The prompt is ~750 words with explicit behavior
   rules. Real conversations will reveal whether it produces
   genuinely-Socratic behavior or drifts into info-dumping. Two early signals
   to watch:
   - `chat_completed` log line's `reply_chars` field — sustained values
     above ~1500 mean the tutor is going long; tighten the style section.
   - The cards block: if the tutor is emitting 3+ cards every turn, the
     "0-3 cards per turn, most turns 0-1" instruction needs sharpening or
     a model swap to a smaller model that defers more.

2. **Eval output discipline.** Haiku is asked to produce strict JSON. If
   parse failures show up in `wrangler tail` (`evaluation_json_parse_failed`
   / `evaluation_zod_validation_failed` counts), options:
   - Add `response_format: {type: "json"}` if Anthropic adds it (not yet
     a Messages API feature at time of build).
   - Switch to Sonnet for eval (more expensive but better instruction
     following).
   - Wrap the eval call in a single retry on parse failure.

3. **Card mastery progression.** The schema has `mastery: 0..5` but Stage 4
   never advances it. Stage 5 (frontend review UI) is the natural place to
   add a mastery-bump endpoint when the student demonstrates recall. Until
   then, every card stays at mastery=0 and the "weakest" sort
   tie-breaks on `created_at DESC`.

4. **Misconception fuzzy-match collisions.** The merge uses bidirectional
   substring matching to dedupe misconceptions. False positives are
   possible with very short descriptions ("dates" matches "dates of
   industrialization" matches "important dates"). If we see this in
   practice, swap to embedding-distance matching (out of Stage 4 scope).

5. **Eval wall-clock budget.** Eval runs in `ctx.waitUntil` so it doesn't
   block the user reply, but the worker stays alive until it finishes.
   At ~2s for Haiku on a small prompt, this is fine. If we add streaming
   to the chat reply later, eval will need to start as the stream finishes
   so it doesn't extend the worker's lifetime past the user's perception
   of the reply being done.
