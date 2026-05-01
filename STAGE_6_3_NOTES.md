# Stage 6.3 — Notes

## What was built

A simpler audio surface. The per-message speaker icons from Stage 6.1
are gone. There's now exactly one audio control: a master toggle in
the chat header that says ON or OFF. When ON, every new tutor reply
auto-plays AND tapping any prior tutor bubble replays it. When OFF,
audio is silent and bubbles are inert.

| File / module                                  | Purpose                                                                |
| :--------------------------------------------- | :--------------------------------------------------------------------- |
| `pages/src/components/audio-player.ts`         | `play()` always restarts from beginning (seek 0 if cached, else load). `pause()` removed. `stopAllAudio()` exported for the toggle. `console.error` on real failures. |
| `pages/src/state.ts`                           | `audio.autoplay` → `audio.enabled`. New `audio_enabled` localStorage key. Migration helper copies the legacy `audio_autoplay` value on first load and deletes the old key. |
| `pages/src/views/chat.ts`                      | New `AudioToggle` (replaces `AutoplayToggle`), stops playback on flip-off. `SpeakerButton` removed. Tutor bubbles get `role="button"`, tabindex, click + Enter/Space handlers — all gated on the live `audio.enabled` state at click time. `data-audio-enabled` attribute set on `.chat-view` so CSS toggles cursor/tap-flash without re-rendering bubbles. |
| `pages/src/components/audio-icons.ts`          | `SPEAKER_ICONS` / `SPEAKER_LABELS` deleted. `ICON_VOLUME_ON` / `ICON_VOLUME_OFF` retained for the master toggle. |
| `pages/src/styles/chat.css`                    | `.msg-speaker` rules removed. `.msg-tutor` `padding-right: 36px` reservation removed. New tap-flash + cursor rules gated on `.chat-view[data-audio-enabled="true"]`. `.autoplay-toggle` renamed to `.audio-toggle` (44×44 tap target, up from 40×36). |

## Verified locally

| Acceptance criterion                                                              | Result |
| :-------------------------------------------------------------------------------- | :----: |
| `npm run typecheck` (worker + pages + functions)                                  | ✓      |
| `npm run test` — **47/47 still green**, no regressions                             | ✓      |
| `npm run build:pages` — JS / CSS rebuild clean                                    | ✓      |
| No per-message speaker icons rendered (`grep msg-speaker` is empty)               | ✓      |
| `SpeakerButton`, `SPEAKER_ICONS`, `SPEAKER_LABELS` all deleted (no dead refs)     | ✓      |
| `audio.enabled` defaults to `true` on first load                                  | ✓      |
| Legacy `audio_autoplay` key migrates to `audio_enabled` on first load             | ✓      |
| All files under 300 lines (max: `pages/src/views/chat.ts` at 278)                 | ✓      |
| No `console.*` outside `lib/logger.ts` (worker) and `audio-player.ts` (frontend, spec-allowed) | ✓ |

## Acceptance criteria deferred to operator manual testing

| Check                                                                               | How                                                                                                |
| :---------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------- |
| Single audio toggle visible in the chat header at all times                         | Open the deployed Pages site; observe the speaker glyph at top-right of the chat surface.          |
| Toggle persists across page reloads                                                 | Toggle off; reload; verify it's still off. Toggle back on; reload; still on.                       |
| Default state on first visit (no localStorage entry) is ON                          | Clear site data; reload; verify the toggle shows ON.                                               |
| New tutor reply auto-plays when audio is ON                                         | Send a message with the toggle ON; the reply should be voiced without interaction.                 |
| Tapping a prior tutor bubble replays it (cancels current playback)                  | Send a few messages; tap an older bubble — old audio stops, tapped audio plays from the beginning. |
| Tapping when audio is OFF is a no-op                                                | Toggle off; tap a bubble; nothing happens.                                                         |
| Flipping ON→OFF mid-playback stops audio immediately                                | Start playback, flip the toggle off; sound stops on the same frame.                                |
| Tapping a user message bubble does nothing                                          | Tap your own message; no audio, no flash.                                                          |
| Replay is near-instant after the first play (R2 cache + cached audio element)       | Tap the same bubble twice; the second start should be sub-100ms.                                   |
| Mobile (375px viewport): toggle reachable, bubble taps don't conflict with selection | iOS Safari: long-press still selects text; quick tap triggers replay.                              |

## Decisions / deviations from the prompt

1. **`MessageAudio.play()` always restarts from the beginning.** The
   previous resume-from-pause semantics existed because the per-message
   icon was a play/pause toggle. With per-message icons gone, there's no
   way to pause; every interaction is "play this from the start." If the
   audio is already loaded (cached blob URL on the instance), we seek
   `currentTime = 0` — instant. Otherwise load fresh via `/api/tts`,
   which hits the R2 cache on a repeat for near-instant turnaround.

2. **`MessageAudio.pause()` deleted.** Nothing in the new UX exposes
   pause. Keeping it would be dead code.

3. **`stopAllAudio()` exported** as a module-level function rather than
   exposing the private `currentlyPlaying` reference. The toggle's
   off-handler calls it; nothing else has reason to.

4. **Bubble click handler is always attached, with a runtime
   `app.get().audio.enabled` check.** The alternative — toggling
   `addEventListener` / `removeEventListener` on every state change —
   would require subscribing each bubble to the audio slice, which is
   per-bubble subscription bookkeeping for no real win. Cursor and
   tap-flash visual hints are gated via CSS reading the
   `data-audio-enabled` attribute on `.chat-view`, so they reflect
   live state without rebuilds.

5. **Bubbles render as `role="button"` always**, even when audio is
   off. The screen-reader contract stays consistent (every assistant
   message is a button); only the visual interactivity hint changes.
   Toggling the role would force per-bubble subscriptions and
   complicate keyboard-focus management.

6. **Tap-flash uses CSS `:active`** with a `transition: background-color
   100ms ease-out`. No JS class toggle needed — the browser's native
   `:active` pseudo handles touch and click identically.

7. **Tap target on the toggle bumped to 44×44** (was 40×36 in Stage
   6.1). The spec calls for "minimum 44x44 CSS pixels for thumb reach"
   and the previous size violated it.

8. **State migration runs once at module load.** `loadAudioEnabledPreference`
   reads the new key first; if absent, looks up the legacy
   `audio_autoplay` key, copies its value, and deletes the legacy key.
   Tolerant of privacy-mode storage failures (returns the default).
   Idempotent: subsequent reads find the new key and skip the migration
   branch entirely.

9. **`console.error` calls in `audio-player.ts`** are the one place the
   frontend uses `console.error`, per the spec's explicit allowance for
   genuine audio-failure logging. Each call is annotated with an
   `eslint-disable-next-line` comment so the intent is visible to a
   future reader (or linter).

## Cache observations (carried forward from Stage 6.1)

Replay should generally be near-instant:

- **First play of a given message**: POST `/api/tts` → upstream
  ElevenLabs (cache MISS) → response streams back, audio plays.
  Latency ~1–3s on a fast connection.
- **Subsequent replays of the same message in the same page session**:
  the `MessageAudio` instance still holds the loaded `<audio>` element
  and its blob URL — `play()` just seeks `currentTime = 0` and resumes.
  Sub-100ms.
- **Replay after page reload (or a different session)**: POST `/api/tts`
  → R2 cache HIT → response streams back. Fast (~100–300ms) but not
  instant; bound by network round-trip + R2 read.

Storage cost scales with the number of distinct messages played in a
single page session (each holds a blob URL until page reload). Bounded
by the verbatim window (~30) plus historical hydration (~50). A few
MB peak; reset by full reload.

## Open questions

1. **Hidden affordance discoverability.** Spec is intentional about not
   adding a tooltip or "tap to replay" hint. The first time Kayla
   wants to re-hear something, she may not realize tapping the bubble
   does anything. Possible mitigation later if real-use signals it: a
   one-time inline hint after the third or fourth message ("by the way,
   you can tap any of these to replay"), shown once per device. Out of
   scope here.

2. **No "playing now" indicator.** Spec excluded this deliberately. If
   she taps multiple bubbles in quick succession with no audio context,
   it could feel disorienting. Watch for this in real use; if needed,
   a faint underline on the currently-playing bubble would be a small
   addition.

3. **Browser autoplay policy timing.** The user gesture from clicking
   "Send" should propagate to the auto-play call ~1–3s later when the
   tutor reply arrives. iOS Safari is the most likely blocker. If
   blocked, the audio fails silently (logged via `console.error`) and
   the next tap on the bubble works because that's a fresh user
   gesture.

4. **The `audio` slice now has a single field.** The state shape lost
   weight; if we ever add volume / speed / voice controls, the slice
   has room. Keeping the wrapper object instead of flattening to a
   top-level `state.audioEnabled` makes future additions a one-line
   change.

5. **Stage 6.1's "loading" / "error" states on `MessageAudio`** are
   still produced by the class but no longer rendered anywhere — the
   old per-message speaker was the only consumer. The state is still
   internally useful (e.g. preventing concurrent `play()` calls on the
   same instance) and the listener pattern is preserved in case a
   future stage wants to surface state again.
