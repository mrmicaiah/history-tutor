# Stage 6.4 — Notes

## What was built

A small italic-serif label — "Tap a message to replay" — added to the
chat header, immediately to the left of the audio toggle. Visible only
when audio is enabled. Hidden via `display: none` when the toggle is
flipped to OFF (no replay possible, so no hint to surface).

| File / module                   | Purpose                                                             |
| :------------------------------ | :------------------------------------------------------------------ |
| `pages/src/views/chat.ts`       | New `ReplayHint` component subscribed to `state.audio.enabled`.     |
| `pages/src/styles/chat.css`     | `.replay-hint` (italic serif, 13px, soft grey) + 10px gap on header.|

## Verified locally

| Acceptance criterion                                                            | Result |
| :------------------------------------------------------------------------------ | :----: |
| `npm run typecheck` (worker + pages + functions)                                | ✓      |
| `npm run test` — 47/47 still green                                              | ✓      |
| `npm run build:pages` — JS / CSS rebuild clean                                  | ✓      |
| Hint mounts in chat header when audio is enabled                                | ✓ (code review) |
| Hint hides on toggle flip OFF and reappears on flip ON, no reload required      | ✓ (subscribed to `audio.enabled` slice) |
| Default audio = ON → hint visible on first app open                             | ✓ (Stage 6.3 default unchanged) |
| All files under 300 lines (max: `pages/src/views/chat.ts` at 294)               | ✓      |
| No `console.*` outside `lib/logger.ts` and `audio-player.ts`                    | ✓      |

## Acceptance criteria deferred to operator manual testing

| Check                                                                       | How                                                                                       |
| :-------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| Hint reads as "Tap a message to replay" in soft italic serif                | Open the deployed site; observe the chat header.                                          |
| Hint disappears when audio toggle is OFF, reappears when ON                 | Flip the toggle a few times; verify the label tracks the state instantly.                 |
| Mobile (375px viewport): hint readable, doesn't push toggle off-screen       | Chrome devtools mobile emulation at 375px; verify the hint and 44×44 toggle both fit.     |
| Hint is visually secondary to the title (not bold, recedes when reading)    | Eyeball test on the deployed site.                                                        |

## Decisions / deviations from the prompt

1. **Inline layout chosen, not stacked-below.** The chat header at 375px
   is just the 44×44 toggle right-aligned (no chat-header title text;
   the app title lives in the app-shell header above). The hint at
   ~13px italic serif renders in roughly 150–180px, leaving plenty of
   room next to the toggle even at the narrowest mobile viewport. The
   stacked-below alternative would add a horizontal rule and burn
   vertical space for one short line — overkill at any breakpoint.

2. **`display: none` for hide**, not DOM removal. Cheaper than
   detach/re-insert; works with the existing `gap: 10px` so layout
   collapses cleanly when the hint is hidden. The header reverts to
   "just the toggle, right-aligned" — visually identical to the
   pre-Stage-6.4 chat-header.

3. **Reused `--ink-faint`** (`#888` from Stage 5's `base.css`) for the
   "soft grey" color rather than introducing a new token. Matches the
   existing palette and keeps the variable surface from sprawling.

4. **No explicit `aria-hidden`.** Default is implicitly false. When
   `display: none` takes effect, screen readers naturally skip the
   element — the same accessibility outcome the spec asked for, with
   one fewer attribute on the markup.

5. **`pointer-events: none` on the hint.** The label is informational;
   blocking pointer events on it ensures a tap on the hint area falls
   through (where appropriate) rather than being absorbed by the
   non-interactive span.

## Open questions

1. **The hint and toggle compete for the same visual zone.** If the
   header ever grows a third element (a title, a notification dot,
   anything), the inline layout will need a rethink. For now the
   header is two items right-aligned with a single 10px gap; trivial
   to extend if needed.

2. **Localization is not threaded.** The hint text is hardcoded
   English. Same as every other UI string in the app. Out of scope
   for Stage 6.4.

3. **No first-visit dismissal.** The hint is always present (when
   audio is on), every visit. The spec was deliberate about this:
   "quietly present — Kayla notices it when she's looking, ignores it
   when she's reading." If real use signals it's stale after a week,
   adding a "dismiss after Nth visit" gate is a 5-line change.
