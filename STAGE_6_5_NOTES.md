# Stage 6.5 — Notes

## What was built

A new `## Connecting to Kayla's interests` section inserted into the
tutor system prompt, between the Stage 6.2 `## Student` section and
the existing `## Style` section. It tells the tutor what Kayla cares
about (Hamilton, theater, anime/manga, Japanese history) and gives
five strict rules for using those interests as teaching anchors —
with a curated list of high-value connections and a list of
anti-patterns to avoid.

| File / module                       | Purpose                                                    |
| :---------------------------------- | :--------------------------------------------------------- |
| `worker/src/prompts/tutor.ts`       | One-section insert, ~50 lines added. No other edits.       |

## Verified locally

| Acceptance criterion                                                          | Result |
| :---------------------------------------------------------------------------- | :----: |
| `npm run typecheck` (worker + pages + functions)                              | ✓      |
| `npm run test` — 47/47 still green                                            | ✓      |
| Section placed between `## Student` and `## Style`                            | ✓      |
| No other files changed beyond the prompt and this notes file                  | ✓      |
| `worker/src/prompts/tutor.ts` line count: 160 (well under 300 cap)            | ✓      |

## Acceptance criteria deferred to operator manual testing

| Check                                                                         | How                                                                                            |
| :---------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| Tutor reaches for Hamilton when teaching the Atlantic Revolutions             | Real `ANTHROPIC_API_KEY`; ask about the French Revolution, Lafayette, or Locke; eyeball.       |
| Tutor reaches for Meiji-era anime when teaching Japan's late-1800s modernization| Same; ask about the Meiji Restoration; observe whether the tutor links naturally to anime.     |
| Tutor does NOT force Hamilton into Mansa Musa / Mongol / Saharan-trade lessons| Ask about Mansa Musa or the Mongols; the reply should teach directly without forced analogy.   |
| Connections are framed as observations, not teaching devices ("You know how…")| Eyeball any reply that uses a connection.                                                      |
| At most one comparison per turn                                               | Eyeball — multiple connections in one reply is the failure mode.                               |
| Comparisons appear during EXPLANATIONS, not when probing/asking               | If the tutor opens with "Like in Hamilton, can you tell me about…", the rule is being violated.|

## Decisions / deviations from the prompt

1. **Heading capitalization normalized to sentence case** —
   `## Connecting to Kayla's interests` rather than the spec's
   ALL CAPS `## CONNECTING TO KAYLA'S INTERESTS`. Every other top-
   level heading in this prompt uses sentence case (`## Student`,
   `## Style`, `## Coverage strategy`, `## What not to do`); matching
   that convention keeps the document visually consistent.

2. **Sub-categories rendered as `**bold inline labels:**`** — the
   spec used inline ALL-CAPS labels (`STRICT RULES for using this:`,
   `HIGH-VALUE CONNECTIONS:`, `WHAT TO AVOID:`). The existing prompt
   uses bold for emphasis within `##` sections (e.g. `**Knows it well**
   → ...` in the diagnostic-method section) and never uses ALL CAPS
   inside body text. I converted the three labels to that pattern.

3. **All rules and the high-value connections list preserved verbatim.**
   Only the heading capitalizations are normalized. Item ordering,
   wording, examples, and edge cases all match the spec exactly.

4. **No code changes anywhere else.** No new types, no schemas, no
   tests. The spec said this is a single-file change, and treating it
   as anything more would be over-engineering.

## Open questions

1. **Tutor adherence to "at most one comparison per turn" and
   "frame as observation, not teaching device"** is a model-discipline
   question, not a code one. Watch real conversations; if the tutor
   piles on Hamilton references or opens questions with "Like in
   Hamilton…", tighten the wording or add a negative example.

2. **The high-value connections list is curated**, not exhaustive.
   When the tutor encounters a connection NOT in the list (e.g. a
   different musical, a different era of anime), it has to decide for
   itself whether the analogy is "substantive and accurate." Trust
   Sonnet to make that call; revisit if real use shows it pulling in
   bad analogies.

3. **No tracking of which comparisons land vs. fall flat.** Stage 4's
   evaluation pass could in principle note "tutor used Hamilton
   reference, student said it helped" — but the eval JSON schema
   wasn't built for this and bolting it on would expand scope. Defer
   until there's evidence it matters.

4. **Interests are hardcoded in the prompt.** Per the spec ("hardcoded
   in the prompt is correct"). If interests ever evolve, edit
   `tutor.ts` and redeploy. No infrastructure for a "tell me your
   interests" flow.

5. **The new section adds ~50 lines to the system prompt, ~600 input
   tokens.** Sent on every chat call. With Anthropic's prompt caching
   on by default in our `lib/anthropic.ts` setup (or trivially
   addable), this cost amortizes to near-zero across a session. If
   not yet cached, worth a follow-up.
