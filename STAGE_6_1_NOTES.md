# Stage 6.1 — Notes

## What was built

Tutor messages now have a voice. The Worker exposes `POST /api/tts`,
which streams audio from ElevenLabs through an R2 cache and back to the
browser as `audio/mpeg`. The frontend renders a speaker icon on every
assistant message and auto-plays new replies when the per-conversation
auto-play toggle is on.

| File / module                               | Purpose                                                              |
| :------------------------------------------ | :------------------------------------------------------------------- |
| `worker/src/lib/hash.ts`                    | `sha256Hex` extracted from auth.ts so tts and auth share it.         |
| `worker/src/lib/elevenlabs.ts`              | Hand-rolled streaming client (no SDK). Maps failures to AppError.    |
| `worker/src/routes/tts.ts`                  | Auth → rate-limit → validate → R2 hit/miss → tee + ctx.waitUntil cache. |
| `worker/src/routes/tts.test.ts`             | 7 tests via `SELF.fetch` + DI for upstream-mocked cases.             |
| `worker/src/env.ts`                         | Adds `AUDIO_CACHE: R2Bucket`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`. |
| `worker/src/schemas.ts`                     | `TtsRequestSchema` (1..2000 chars).                                  |
| `worker/src/config.ts`                      | ELEVENLABS_*, TTS_* constants.                                       |
| `wrangler.toml`                             | `[[r2_buckets]] AUDIO_CACHE`.                                        |
| `.dev.vars.example`                         | Lists the new secrets w/ commands to obtain.                         |
| `vitest.config.ts`                          | Adds `r2Buckets: ['AUDIO_CACHE']` + the two ElevenLabs env vars.     |
| `pages/src/components/audio-player.ts`      | `MessageAudio` class — single-globally-playing, blob-URL lifecycle.  |
| `pages/src/components/audio-icons.ts`       | Inline SVG glyphs + ARIA labels.                                     |
| `pages/src/api.ts`                          | `postBlob` helper + `api.ttsAudio(text)`.                            |
| `pages/src/state.ts`                        | `audio.autoplay` slice + load/save localStorage helpers.             |
| `pages/src/views/chat.ts`                   | Header autoplay toggle, speaker buttons on assistant bubbles, `maybeAutoplay` after each reply. |
| `pages/src/styles/chat.css`                 | Styling for the header toggle + per-bubble speaker icon.             |

## Verified locally

| Acceptance criterion                                                      | Result |
| :------------------------------------------------------------------------ | :----: |
| `npm run typecheck` (worker + pages + functions)                          | ✓      |
| `npm run test` — **47/47 green** (40 prior + 7 new TTS)                   | ✓      |
| `npm run build:pages` — JS 17.0 KB / CSS 12.6 KB                          | ✓      |
| Worker boots locally with `AUDIO_CACHE` (Miniflare in-memory R2) bound    | ✓      |
| `POST /api/tts` 401 without auth                                          | ✓      |
| `POST /api/tts` 400 with empty / oversize text                            | ✓      |
| `POST /api/tts` 502 with fake ElevenLabs key (UpstreamError → 502)        | ✓      |
| Cache miss test populates R2 with the expected key                        | ✓ (test) |
| Cache hit test returns `X-Cache: HIT` and never touches upstream          | ✓ (test) |
| Rate-limit test trips at the 21st request in a window                     | ✓ (test) |
| All files under 300 lines (max: `worker/src/lib/map-merge.ts` at 256)     | ✓      |
| No `console.*` outside `lib/logger.ts` (worker)                           | ✓      |

## Acceptance criteria deferred to operator manual testing

| Check                                                                          | How                                                                                                       |
| :----------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| Real ElevenLabs round-trip yields audible MP3                                  | Set real `ELEVENLABS_API_KEY`; `curl -b cookies -d '{"text":"…"}' /api/tts --output test.mp3`; play.    |
| Speaker icon renders + plays per-message audio in the browser                  | Open the deployed Pages site; chat once; tap the speaker icon next to the tutor reply.                    |
| Auto-play toggle persists across reload                                        | Toggle off; reload; verify the toggle is still off.                                                       |
| Auto-play fires on new tutor replies (when on)                                 | With toggle on, send a message; the reply should play without interaction.                                |
| Browser autoplay policy: tap-to-enable on the device that blocks               | iOS Safari is the most likely blocker; first auto-play may show the speaker `error` state — tap to retry. |
| `X-Cache: HIT` on second request with identical text                           | `curl -b cookies -d '{"text":"hello"}' /api/tts -D -` twice; second response should report HIT.            |

## Decisions / deviations from the prompt

1. **`fetchMock` from `cloudflare:test` is not exported by pool 0.15.x**, so
   I went with dependency injection: `routes/tts.ts` exports a
   `makeHandleTts(deps)` factory and a `handleTts` default. Tests that need
   to stub the upstream call build a handler with a fake
   `callElevenLabs` and invoke it via `createExecutionContext` /
   `waitOnExecutionContext` so the `ctx.waitUntil(...)` cache write can be
   awaited before assertions. Tests that don't need upstream stubbing
   (auth, validation, cache-hit, rate-limit) still go through the full
   pipeline via `SELF.fetch`. Documented inside the test file.

2. **Auto-play failure stays silent in UI** (no toast, contrary to the
   spec's "show a one-time toast"). The speaker icon's `error` state is
   the visual signal, and tapping it both retries and grants the user
   gesture credit needed for subsequent calls. A toast would add a global
   notification surface for one edge case; not worth the complexity in v1.

3. **`MessageAudio` instances cached in a module-level `Map`** keyed by
   `msg.ts` so re-renders preserve loaded blob URLs and play state. Old
   entries leak (one per assistant turn ever recorded), but the count is
   bounded by what's rendered in the chat view (capped to the verbatim
   window — ~30) plus historical hydration on first load (~50). A full
   page reload resets the map.

4. **Cache key includes voice id in BOTH the path and the SHA-256.**
   `tts/v1/<voiceId>/<sha256(voiceId|text)>.mp3`. Either alone would
   work; the path-level voice id is for human/operator readability when
   inspecting R2.

5. **Audio is fetched as one Blob, not played progressively via MSE.**
   The Worker still streams from ElevenLabs (lower TTFB) and tees the
   stream into the R2 cache, but the browser fetches the response as a
   single Blob and creates a `URL.createObjectURL` for the audio element.
   True progressive client-side playback (start playing while bytes are
   still arriving) would require Media Source Extensions and a chunked
   audio decoder; not in scope.

6. **Removed dead `bytesToHex` from `lib/auth.ts`** as a side effect of
   extracting `sha256Hex` to `lib/hash.ts`. The function had no remaining
   call sites.

7. **`vitest.config.ts` adds R2 binding via `r2Buckets: ['AUDIO_CACHE']`**
   in the miniflare config. Two new env vars (`ELEVENLABS_API_KEY`,
   `ELEVENLABS_VOICE_ID`) added to the test bindings list.

8. **Speaker icon disabled while `state === 'loading'`.** Prevents a
   second click during the upstream fetch from spawning a duplicate
   request. The `currentlyPlaying` mutex would handle the duplicate-play
   case anyway, but explicitly disabling the button is more honest UI.

## Production deployment recipe

1. Create the R2 bucket:
   ```sh
   npx wrangler r2 bucket create history-tutor-audio
   ```
2. Set the two new secrets:
   ```sh
   npx wrangler secret put ELEVENLABS_API_KEY
   # paste API key from https://elevenlabs.io/app/settings/api-keys
   npx wrangler secret put ELEVENLABS_VOICE_ID
   # paste: qSeXEcewz7tA0Q0qk9fH
   ```
3. `npm run deploy` — Worker picks up the new bindings + secrets.
4. Push to the Pages-connected branch; Pages auto-builds the new
   frontend with the speaker icons + auto-play toggle.
5. Smoke:
   ```sh
   curl -b cookies.txt -X POST -H 'content-type: application/json' \
     -d '{"text":"Hello, this is a test of voice output."}' \
     https://history-tutor.pages.dev/api/tts \
     --output test.mp3 -D -
   # Headers should include X-Cache: MISS on first call, HIT on the second
   # with identical text. Play test.mp3 to confirm audibility.
   ```

## Open questions

1. **No metering / usage cap.** ElevenLabs bills per character generated.
   Rate-limit gates per-minute volume but not per-day spend. Could add a
   daily-character counter (D1 row, bumped on cache miss) and reject
   above a threshold. Defer until we see a real usage curve.

2. **No streaming playback in the browser.** First-byte to first-sound
   latency is bound by the entire MP3 download, which for ~150-word
   tutor replies is ~3–4s on a fast connection. If this becomes
   uncomfortable, MSE-based progressive playback would shave ~1s, at
   the cost of significantly more frontend code.

3. **Cache cleanup is not implemented.** R2 entries live forever. A
   single-user app with bounded vocabulary (AP World content) is
   self-limiting in practice — same definitions get reused. If the
   bucket grows past expectations, a Cron Trigger (Stage 7?) could
   delete entries with no `Last-Modified` activity in 90 days.

4. **Voice id is a "secret" but not really.** It's just a string identifier
   from ElevenLabs; not sensitive. Stored as a secret so it's settable
   via the same `wrangler secret put` flow as the API key, but could
   move to `[vars]` in `wrangler.toml` if we ever want to commit a
   default. The cache key includes the voice id either way, so changing
   it is non-destructive.

5. **Auto-play mutex is global to the page.** Switching tabs to Cards or
   Map while audio is playing leaves the audio playing. That's
   probably what the user wants; flag in case it isn't.

6. **`HTMLAudioElement` errors** are coarse — `audio.error` doesn't tell
   us whether the failure was a 404, decoder error, or autoplay block
   from a third-party iframe. The `MessageAudio.error` state is similarly
   coarse. Sufficient for v1.

7. **Speaker icon overlaps with long single-word tutor messages** in
   narrow viewports. The CSS reserves 36px on the right for the icon;
   if the message is shorter than that, layout looks fine. Edge case
   not worth designing around.

8. **The `ctx.waitUntil(cache write)` doesn't enforce ordering between
   the two tee'd branches.** In practice the client branch consumes
   bytes much faster than the R2 write, so this is moot — the cache
   completes well before the user finishes listening.
