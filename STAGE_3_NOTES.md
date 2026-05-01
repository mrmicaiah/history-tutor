# Stage 3 — Notes

## What was built

The chat loop is no longer a goldfish. Stage 2's "load the last 20 turns and
go" memory has been replaced with the layered memory model:

```
systemPrompt = base_prompt + knowledge_map + session_summary
messages     = recent verbatim turns (≤ MAX_RECENT_TURNS, oldest first,
                 excluding anything already folded into the summary)
```

When the verbatim window exceeds `COMPACTION_TRIGGER_TURNS` (30), a
background `ctx.waitUntil`-scheduled compaction pass folds the oldest
`COMPACTION_BATCH_SIZE` (10) turns into a running narrative summary and
deletes them from `turns`. Steady state: ~20–30 verbatim turns + an
ever-current summary + a (Stage-4-populated) knowledge map.

| Module                                  | Purpose                                                   |
| :-------------------------------------- | :-------------------------------------------------------- |
| `worker/migrations/0002_memory.sql`     | Adds `turn_metadata` (FK + ON DELETE CASCADE).            |
| `worker/src/types/curriculum.ts`        | EraId / ThemeId / ExamSkill / Competence literal unions.  |
| `worker/src/types/knowledge-map.ts`     | `KnowledgeMap` type + Zod schema + `emptyKnowledgeMap()`. |
| `worker/src/lib/memory.ts`              | load/save/buildClaudeInput.                               |
| `worker/src/lib/compaction.ts`          | `compactIfNeeded` w/ atomic `db.batch` + DI for callClaude.|
| `worker/src/lib/memory.test.ts`         | 10 tests (read/write, watermark, prompt assembly).        |
| `worker/src/lib/compaction.test.ts`     | 7 tests (no-op / batch / atomicity).                      |
| `worker/src/test/{setup,helpers,env.d.ts}` | Pool migrations + per-test reset + Cloudflare.Env aug.  |
| `vitest.config.ts`                      | `cloudflareTest` Vite plugin (pool 0.15+ API).            |

Modified: `worker/src/config.ts` (compaction constants), `worker/src/routes/chat.ts`
(uses `buildClaudeInput`, schedules compaction via `ctx.waitUntil`),
`worker/tsconfig.json` (adds `@cloudflare/vitest-pool-workers` to types),
`package.json` (vitest 2 → 4, adds pool dep).

## Verified locally

| Acceptance criterion                                                       | Result |
| :------------------------------------------------------------------------- | :----: |
| `npm run typecheck`                                                        | ✓      |
| `npm run test` — 17 tests, all green (16 from spec + 1 bonus loadSummary)  | ✓      |
| Migration `0002_memory.sql` applies on top of an existing Stage-2 DB       | ✓      |
| Migrations apply cleanly to a fresh DB (`rm -rf .wrangler && db:migrate`)  | ✓      |
| Stage 1+2 endpoints unchanged (`/api/health`, `/api/auth/*`, `/api/chat`)  | ✓      |
| Chat handler now uses `buildClaudeInput` (knowledge map + summary)         | ✓      |
| Compaction scheduled via `ctx.waitUntil` (non-blocking)                    | ✓      |
| Compaction failure (mocked Claude throw) does NOT delete turns             | ✓ (test) |
| `loadRecentTurns` excludes turns ≤ `last_compacted_turn_id`                | ✓ (test) |
| All files under 300 lines (max 227, `lib/memory.ts`)                       | ✓      |
| No `console.*` outside `lib/logger.ts`                                     | ✓      |

## Decisions / deviations from the prompt

1. **Pool API: `cloudflareTest` Vite plugin, not `defineWorkersConfig`.**
   The spec sketched the older pool config style, but `@cloudflare/vitest-
   pool-workers@0.15+` (current latest) replaced `defineWorkersConfig` with
   the `cloudflareTest` Vite plugin pattern. Same capabilities, different
   wiring. Documented in `vitest.config.ts`.

2. **Vitest 2 → Vitest 4.** The current pool requires `vitest@^4`. We were
   on `vitest@^2`; bumping is consistent with Stage 1's "latest stable" rule
   for dev deps. Our test surface is small enough that the major bump
   touched zero of our code.

3. **Cloudflare.Env namespace, not `ProvidedEnv`.** Pool 0.15+ surfaces test
   bindings via the global `Cloudflare.Env` interface. The spec's mental
   model of `interface ProvidedEnv extends Env` from older pool docs no
   longer applies. `worker/src/test/env.d.ts` augments the new namespace.

4. **`callClaude` is dependency-injected into `compactIfNeeded`.** Default
   parameter `deps = { callClaude }`; tests pass a `vi.fn()`. This avoids
   `vi.mock` (fragile in the workers pool's runtime) and produces a cleaner
   atomicity test: a thrown mock results in the spec's required
   "no turns deleted" guarantee being directly observable.

5. **`addressed_turn_id?: number | undefined` in `KnowledgeMap`.** Required
   for compatibility with Zod's `.optional()` output under
   `exactOptionalPropertyTypes: true`. The field can be omitted OR explicit
   undefined — semantically equivalent for our purposes.

6. **Compaction trigger semantics.** The spec said "more than 30" and "at 30
   compact again"; I implemented `if (count > COMPACTION_TRIGGER_TURNS)
   compact`, so count=30 is no-op and count=31 triggers. With BATCH=10,
   post-pass count is `count − 10`. Steady-state floor is therefore 21,
   not the spec's nominal "20" — close enough that I assume the spec was
   approximating. `COMPACTION_KEEP_RECENT = 20` is exposed as informational.

7. **Compaction PRAGMA placement.** The spec called for `PRAGMA
   foreign_keys = ON` as the first statement of the `db.batch()`. This is
   the only place in the codebase where the PRAGMA reliably affects
   subsequent statements (D1 batches share a connection), and it's also the
   only place where it matters — `turn_metadata.turn_id ON DELETE CASCADE`
   needs FKs on for the cascade to fire when we delete compacted turns.

8. **Defensive trim of leading-`assistant` turn in `buildClaudeInput`.** The
   chat route inserts user→assistant pairs, and BATCH_SIZE=10 (even) keeps
   the oldest verbatim turn after compaction always `user`. But if BATCH
   ever changes to odd, the messages array would start with `assistant` —
   which Claude rejects. A 3-line `while` shaves leading non-user turns
   defensively. Worth the safety net since the failure would be cryptic.

9. **Bonus `loadSummary` test.** The required tests all verify behavior
   *via* loadSummary, but no test pinned its empty-state contract. Added
   one — single it() block, three lines.

## Acceptance criteria deferred to operator manual testing

| Check                                                              | How to run                                                                                                |
| :----------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| End-to-end compaction triggers after 30+ real chat turns           | Real `ANTHROPIC_API_KEY` in `.dev.vars`, then 31× `curl …/api/chat`. Then `SELECT * FROM conversation_summary;` |
| Summary text quality looks reasonable for AP World content         | Same setup; eyeball the produced summary string.                                                          |

The unit tests verify atomicity, the watermark advance, and the
prompt-assembly contract. The "is the summary text actually good?" part is
inherently a Claude-quality question that costs API tokens to evaluate.

## Open questions

1. **Compaction model.** I pinned `COMPACTION_MODEL = 'claude-haiku-4-5'`
   per spec. If we later observe summaries losing important specificity
   (names, dates, AP-relevant nuance), bumping to `claude-sonnet-4-5` is a
   one-line change in `config.ts`.

2. **Knowledge map versioning.** Schema is at version 1. Stage 4 will be
   the first writer; if its evaluation logic ever needs a structural change
   (e.g. add `confidence_intervals` per fact), bump to version 2 and add a
   one-shot migration in `loadKnowledgeMap` that detects v1 and upcasts.

3. **Compaction races.** Two near-simultaneous chat calls could both trigger
   compaction (each scheduled via `ctx.waitUntil`). The second would see
   the first's `last_compacted_turn_id`, recount, and likely no-op — but
   the worst case is a redundant Haiku call. Acceptable; no fix needed
   unless we go multi-user.

4. **`turn_metadata` is dead code in Stage 3.** Stage 4 is the writer; the
   table exists only so Stage 4 doesn't need a migration. If Stage 4 ends
   up storing per-turn data differently, drop the table in a Stage 4
   migration rather than carrying it.

5. **Spurious `WebSocket peer disconnected` lines** appear in the test
   output when the pool tears down its Miniflare instance between files.
   These are pool-internal teardown noise, not test failures (every test
   reports green and the process exits 0). Documented upstream as cosmetic.
