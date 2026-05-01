# Stage 6.2 — Notes

## What was built

Three small, deliberate threads of personalization:

1. The tutor system prompt now knows the student's name (Kayla) and is
   told when and how to use it.
2. A static frontend file (`pages/src/data/messages.ts`) holds two pools
   of personal messages from her dad: 15 welcome lines for the PIN gate,
   65 lines that rotate while the tutor is composing a reply.
3. The PIN gate shows one randomly-selected welcome message on mount.
   The chat thinking indicator shows a random line from the second pool
   and rotates to a new one every 12-18 seconds with a 300 ms fade.

| File / module                                  | Purpose                                                              |
| :--------------------------------------------- | :------------------------------------------------------------------- |
| `worker/src/prompts/tutor.ts`                  | Inserts the `## Student` section naming Kayla. No other edits.       |
| `pages/src/data/messages.ts`                   | New file. Two readonly arrays — 15 + 65, exactly as the operator wrote them. |
| `pages/src/views/pin-gate.ts`                  | Replaces the utilitarian subtitle with a randomly-picked welcome message. |
| `pages/src/views/chat.ts`                      | Stable thinking element managed in the view closure so the rotation timer survives `renderMessages` clears. |
| `pages/src/components/thinking-rotation.ts`    | New file. `startThinkingRotation` (returned cleanup fn) — extracted from chat.ts to keep it under the 300-line cap. |
| `pages/src/styles/personal.css`                | New file. `.personal-message` foundation + `.welcome-message` + `.thinking-message`. Sorted last in the build's CSS concat so it overrides per-surface chrome. |

## Verified locally

| Acceptance criterion                                                              | Result |
| :-------------------------------------------------------------------------------- | :----: |
| `npm run typecheck` (worker + pages + functions)                                  | ✓      |
| `npm run test` — **47/47 green**, no regressions                                   | ✓      |
| `npm run build:pages` — JS 20 KB / 5 CSS files concatenated                       | ✓      |
| `WELCOME_MESSAGES` count exactly 15                                               | ✓      |
| `THINKING_MESSAGES` count exactly 65                                              | ✓      |
| Tutor prompt contains the `## Student` section naming Kayla                       | ✓      |
| All files under 300 lines (max: `worker/src/lib/map-merge.ts` at 256)             | ✓      |
| No `console.*` outside `lib/logger.ts` and the build script                       | ✓      |

## Acceptance criteria deferred to operator manual testing

| Check                                                              | How                                                                                              |
| :----------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| PIN gate renders a random welcome message on first paint           | Open the deployed Pages site; reload a few times; verify different messages from the 15.         |
| Thinking indicator displays a personal line while the tutor composes | Send a message; observe the indicator before the reply arrives.                                  |
| Indicator rotates after 12-18s with a soft fade                    | Send a message that prompts a long reply (or temporarily slow the upstream); wait ~15s.          |
| Same message never appears twice in a row in the rotation          | Watch through several rotations on a slow reply.                                                 |
| Rotation cleans up when the reply arrives (no leaked timers)       | Send several messages in succession; check devtools Performance / Memory; no growing timer count.|
| Mobile (375px viewport): welcome wraps gracefully, thinking fits   | iOS Safari + Chrome devtools mobile emulation.                                                   |
| Tutor uses "Kayla" naturally in real responses (~once per 3-4 turns) | Real `ANTHROPIC_API_KEY`; have a real conversation; eyeball.                                     |

## Decisions / deviations from the prompt

1. **Double quotes for message strings.** The repo otherwise uses single
   quotes; many of the messages contain apostrophes (`I'm`, `don't`,
   `you're`). Single-quoted with escapes (`'I\\'m here. Always'`)
   would have made the source visually unlike the spec's. I kept the
   strings byte-identical to the spec by using double quotes inside the
   arrays. Rest of the file uses single quotes per the repo convention.

2. **Welcome message replaces the existing subtitle**, but the small
   utilitarian app title (`history-tutor`) stays. Title gives "yes,
   this is the app" context; the welcome message takes over the
   prominent personal-text slot. The spec was loose about this; my
   read is that removing the title would feel disorienting on first
   load.

3. **Thinking indicator owned outside `renderMessages`.** The previous
   render path called `clearChildren(messagesEl)` on every state
   change, which would destroy the rotation timer along with the DOM
   node. The new pattern: a stable element managed in the view
   closure, created on `chat.sending → true` and cleaned up on
   `chat.sending → false`. `renderMessages` re-appends it on each
   render so it stays in the visual stream, but the element itself
   (and its timer) survives detach/re-attach cycles.

4. **Extracted `startThinkingRotation` to its own file** because
   adding it inline pushed `chat.ts` to 341 lines (over the 300 cap).
   The function is self-contained and importable; the cleanup contract
   is unchanged.

5. **`personal.css` is its own file** rather than appended to `chat.css`
   or `base.css`. Sorted alphabetically last by the build script's
   concat order, so its `.thinking-message` rules naturally override
   the older `.chat-thinking` italic/colour from Stage 5 without my
   needing to delete the old rules. The `.chat-thinking` class is
   still present on the element (legacy positioning) — the new class
   provides the typography.

6. **Rotation timing is 12–18 seconds with 300 ms fades** — exactly the
   spec's numbers. Did not speed up "for snappiness." The whole point
   of the slow pace is that it doesn't feel like a UI loader.

7. **First message appears immediately, no fade-in**, per spec.
   Subsequent rotations fade out → swap → fade in (each leg 300 ms).

8. **`textContent` (not `innerHTML`) for the swapped messages**, defending
   against any HTML-like character that might appear in a message string
   in the future. None of the current messages contain any, but the
   defense is free.

## Decisions reaffirmed by NOT doing them

- I did not add or remove any messages.
- I did not edit punctuation, capitalization, or wording.
- I did not add emoji anywhere.
- I did not generalize the lists into a config table or backend feature.
- I did not refactor the existing tutor prompt — the only change is the
  inserted `## Student` section.
- I did not add any new tests. The spec said none required for this
  stage; the merge is UI + a prompt change, both verified by manual
  smoke.

## Open questions

1. **`Math.random()` is fine here, but worth noting.** With 15 welcome
   messages, expected duplicate-on-reload rate is ~1/15 ≈ 6.7 %. With
   65 thinking messages and a "no immediate repeat" rule, the
   perceived randomness is plenty. No need for a seeded shuffle.

2. **Browser tab in background.** When the chat view is hidden (user
   on Cards or Map tab), the rotation timer keeps firing on the
   detached-but-alive element. CSS opacity changes to a hidden
   ancestor are no-ops, so this is harmless. If we ever want to pause
   rotation when hidden, hook `document.visibilityState`.

3. **The welcome-message picker is local to `pin-gate.ts`.** If we
   ever want a deterministic "first session of the day" or "Monday
   morning" rotation, we'd thread a date in. Out of scope.

4. **The thinking-rotation interval timing is hard-coded** in
   `thinking-rotation.ts`. If the operator ever wants 8-12s or
   15-25s, it's a two-constant edit.

5. **The tutor's adherence to "at most once every 3-4 turns" with the
   name** is a model-discipline question, not a code question. If
   logs show overuse (visible in `chat_completed` lines once we look),
   tighten the prompt's wording.

6. **Mobile keyboard interaction with the welcome message**: on iOS,
   focusing the PIN input shifts the viewport and the welcome message
   may scroll out of view — that's the expected mobile-keyboard
   behavior, not something to fight. The message lives above the
   input intentionally.
