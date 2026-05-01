import { log } from './logger';
import { TimeoutError, UpstreamError } from './errors';
import {
  ELEVENLABS_BASE_URL,
  ELEVENLABS_MODEL_ID,
  ELEVENLABS_TIMEOUT_MS,
} from '../config';

/**
 * Minimal ElevenLabs streaming TTS client.
 *
 * Hand-rolled around `fetch` (no SDK) — same reasoning as `lib/anthropic.ts`.
 * The endpoint streams `audio/mpeg`; we hand the upstream `Response` back to
 * the caller, who can either stream it directly to the client or `tee()` it
 * for caching.
 *
 * Failure modes mapped to typed errors:
 *   - Network failure / DNS error      -> UpstreamError (502)
 *   - AbortController fires            -> TimeoutError (504)
 *   - Non-2xx HTTP response            -> UpstreamError (502)
 *
 * Voice settings are baked in for now. Stage 6.2 (if/when) can expose them.
 */

export interface ElevenLabsParams {
  apiKey: string;
  voiceId: string;
  text: string;
}

const VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0,
  use_speaker_boost: true,
};

/**
 * POST to ElevenLabs' streaming endpoint and return the upstream `Response`.
 * The body is an `audio/mpeg` ReadableStream; do not consume it twice without
 * `.tee()`. Throws `UpstreamError` / `TimeoutError` on failure.
 */
export async function streamFromElevenLabs(params: ElevenLabsParams): Promise<Response> {
  const url = `${ELEVENLABS_BASE_URL}/v1/text-to-speech/${encodeURIComponent(params.voiceId)}/stream`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ELEVENLABS_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': params.apiKey,
        accept: 'audio/mpeg',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text: params.text,
        model_id: ELEVENLABS_MODEL_ID,
        voice_settings: VOICE_SETTINGS,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const aborted = err instanceof Error && err.name === 'AbortError';
    if (aborted) {
      log.error('elevenlabs_timeout', { timeout_ms: ELEVENLABS_TIMEOUT_MS });
      throw new TimeoutError('elevenlabs request timed out');
    }
    log.error('elevenlabs_fetch_failed', { error: err });
    throw new UpstreamError('elevenlabs request failed');
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    let snippet = '';
    try {
      const text = await response.text();
      snippet = text.slice(0, 500);
    } catch {
      /* body unreadable */
    }
    log.error('elevenlabs_non_2xx', {
      status: response.status,
      body_snippet: snippet,
    });
    throw new UpstreamError(`elevenlabs returned status ${response.status}`);
  }

  if (response.body === null) {
    log.error('elevenlabs_empty_body', { status: response.status });
    throw new UpstreamError('elevenlabs returned no body');
  }

  return response;
}
