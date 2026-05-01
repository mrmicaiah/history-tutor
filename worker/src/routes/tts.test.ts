import { beforeEach, describe, expect, it } from 'vitest';
import {
  createExecutionContext,
  env,
  SELF,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { makeHandleTts, type TtsDeps } from './tts';
import { createSessionCookie } from '../lib/auth';
import { sha256Hex } from '../lib/hash';
import { resetTables } from '../test/helpers';
import { UpstreamError } from '../lib/errors';
import {
  RATE_LIMIT_TTS_PER_MIN,
  TTS_CACHE_VERSION,
} from '../config';

/**
 * POST /api/tts integration tests.
 *
 * Two access patterns:
 *   - `SELF.fetch(...)` for tests that don't touch upstream (auth /
 *     validation / cache-hit / rate-limit). Exercises the full pipeline.
 *   - Direct `makeHandleTts({...}).fetch(...)` invocation for tests that
 *     need to stub the ElevenLabs upstream call. The auth middleware still
 *     runs because the handler calls it; only the upstream is replaced.
 *     `createExecutionContext` + `waitOnExecutionContext` ensure the
 *     `ctx.waitUntil(...)` cache write completes before assertions.
 *
 * The pool 0.15.x version doesn't expose `fetchMock`, hence the DI route.
 */

const FAKE_AUDIO = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 0x00, 0x01, 0x02, 0x03]);

async function authedHeaders(): Promise<Record<string, string>> {
  const setCookie = await createSessionCookie(env.SESSION_SECRET);
  const cookie = setCookie.split(';')[0]!;
  return { Cookie: cookie, 'content-type': 'application/json' };
}

async function clearAudioCache(): Promise<void> {
  const list = await env.AUDIO_CACHE.list();
  if (list.objects.length > 0) {
    await env.AUDIO_CACHE.delete(list.objects.map((o) => o.key));
  }
}

function cacheKeyFor(text: string, voiceId: string = env.ELEVENLABS_VOICE_ID): Promise<string> {
  return sha256Hex(`${voiceId}|${text}`).then(
    (hash) => `tts/${TTS_CACHE_VERSION}/${voiceId}/${hash}.mp3`,
  );
}

function fakeUpstream(body: BodyInit, init: ResponseInit = {}): TtsDeps {
  return {
    callElevenLabs: async () =>
      new Response(body, {
        status: init.status ?? 200,
        headers: init.headers ?? { 'content-type': 'audio/mpeg' },
      }),
  };
}

function throwingUpstream(message = 'simulated upstream 500'): TtsDeps {
  return {
    callElevenLabs: async () => {
      throw new UpstreamError(message);
    },
  };
}

describe('POST /api/tts', () => {
  beforeEach(async () => {
    await resetTables();
    await clearAudioCache();
  });

  // -------- Tests that exercise the full pipeline via SELF.fetch ---------

  it('401 without a session cookie', async () => {
    const response = await SELF.fetch('http://test.local/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    expect(response.status).toBe(401);
  });

  it('400 with empty text', async () => {
    const response = await SELF.fetch('http://test.local/api/tts', {
      method: 'POST',
      headers: await authedHeaders(),
      body: JSON.stringify({ text: '' }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('validation');
  });

  it('400 when text exceeds the cap', async () => {
    const response = await SELF.fetch('http://test.local/api/tts', {
      method: 'POST',
      headers: await authedHeaders(),
      body: JSON.stringify({ text: 'a'.repeat(2001) }),
    });
    expect(response.status).toBe(400);
  });

  it('cache hit: 200 audio/mpeg with X-Cache: HIT, no upstream call', async () => {
    const text = 'Pre-cached audio body.';
    const key = await cacheKeyFor(text);
    await env.AUDIO_CACHE.put(key, FAKE_AUDIO, {
      httpMetadata: { contentType: 'audio/mpeg' },
    });

    // Use direct invocation with a throwing upstream so any unexpected call
    // would surface as a test failure (rather than going to the real net).
    const handler = makeHandleTts(throwingUpstream('upstream must not run on cache hit'));
    const ctx = createExecutionContext();
    const response = await handler(
      new Request('http://test.local/api/tts', {
        method: 'POST',
        headers: await authedHeaders(),
        body: JSON.stringify({ text }),
      }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Cache')).toBe('HIT');
    const body = await response.arrayBuffer();
    expect(new Uint8Array(body)).toEqual(FAKE_AUDIO);
  });

  it('429 once the rate-limit bucket is exceeded', async () => {
    // Pre-cache so the limiter is the only gate exercised on each call.
    const text = 'rate-limit-pre-cached';
    const key = await cacheKeyFor(text);
    await env.AUDIO_CACHE.put(key, FAKE_AUDIO);

    const headers = await authedHeaders();
    for (let i = 0; i < RATE_LIMIT_TTS_PER_MIN; i++) {
      const ok = await SELF.fetch('http://test.local/api/tts', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text }),
      });
      expect(ok.status).toBe(200);
      await ok.arrayBuffer();
    }
    const limited = await SELF.fetch('http://test.local/api/tts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text }),
    });
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { error: string; retry_after_seconds: number };
    expect(body.error).toBe('rate_limited');
    expect(body.retry_after_seconds).toBeGreaterThan(0);
  });

  // -------- Tests that stub the upstream via DI ---------------------------

  it('cache miss: 200 audio/mpeg with X-Cache: MISS, R2 populated after', async () => {
    const text = 'Hello from ElevenLabs.';
    const handler = makeHandleTts(fakeUpstream(FAKE_AUDIO));
    const ctx = createExecutionContext();
    const response = await handler(
      new Request('http://test.local/api/tts', {
        method: 'POST',
        headers: await authedHeaders(),
        body: JSON.stringify({ text }),
      }),
      env,
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Cache')).toBe('MISS');
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg');

    // Drain the client-facing branch so the tee can finish.
    const body = await response.arrayBuffer();
    expect(new Uint8Array(body)).toEqual(FAKE_AUDIO);

    await waitOnExecutionContext(ctx);

    const key = await cacheKeyFor(text);
    const cached = await env.AUDIO_CACHE.get(key);
    expect(cached).not.toBeNull();
    const cachedBytes = new Uint8Array(await cached!.arrayBuffer());
    expect(cachedBytes).toEqual(FAKE_AUDIO);
  });

  it('502 when the ElevenLabs upstream throws UpstreamError', async () => {
    const handler = makeHandleTts(throwingUpstream('upstream returned 500'));
    const ctx = createExecutionContext();
    // Errors thrown inside the route propagate from the handler — the
    // production dispatcher catches them and maps to a Response. Mirror
    // that here so the test asserts the mapped status.
    let response: Response;
    try {
      response = await handler(
        new Request('http://test.local/api/tts', {
          method: 'POST',
          headers: await authedHeaders(),
          body: JSON.stringify({ text: 'anything' }),
        }),
        env,
        ctx,
      );
    } catch (err) {
      // toErrorResponse mirrors the dispatcher's mapping.
      const { toErrorResponse } = await import('../lib/errors');
      response = toErrorResponse(err, '/api/tts');
    }
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('upstream');
  });
});
