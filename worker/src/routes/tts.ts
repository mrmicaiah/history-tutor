import type { Env } from '../env';
import { errorResponse } from '../lib/responses';
import { ValidationError } from '../lib/errors';
import { TtsRequestSchema } from '../schemas';
import { requireAuth } from '../lib/auth';
import { withDb } from '../lib/db';
import { checkRateLimit } from '../lib/rate-limit';
import { streamFromElevenLabs, type ElevenLabsParams } from '../lib/elevenlabs';
import { sha256Hex } from '../lib/hash';
import { log } from '../lib/logger';
import {
  RATE_LIMIT_TTS_PER_MIN,
  RATE_LIMIT_TTS_WINDOW_S,
  TTS_CACHE_VERSION,
  TTS_CLIENT_CACHE_HEADER,
} from '../config';

/**
 * POST /api/tts
 *
 * Body: `{ text: string }` (1..TTS_MAX_TEXT_LENGTH)
 * Success: 200 audio/mpeg
 *
 * Flow:
 *   1. Auth check.
 *   2. Rate-limit check on the `tts` bucket (uses the same SQL limiter).
 *   3. Validate body.
 *   4. Compute cache key from `(voiceId, text)` SHA-256.
 *   5. R2 lookup:
 *        - HIT  -> stream cached body, X-Cache: HIT.
 *        - MISS -> call ElevenLabs, tee the stream so the client gets the
 *                  audio while a copy is written to R2 via ctx.waitUntil.
 *
 * Cache key:
 *   tts/<version>/<voiceId>/<sha256(voiceId|text)>.mp3
 *
 * The voice id is in both the path AND the hash so a voice change strands
 * old entries deterministically without collisions.
 *
 * R2 read failures are logged and treated as a cache miss (the upstream
 * call still happens; the user still hears their audio). R2 write failures
 * are logged and ignored (next request will retry the cache write).
 */

const TTS_RATE_BUCKET = 'tts';

function buildCacheKey(voiceId: string, hashHex: string): string {
  return `tts/${TTS_CACHE_VERSION}/${voiceId}/${hashHex}.mp3`;
}

function audioResponseHeaders(cacheStatus: 'HIT' | 'MISS'): HeadersInit {
  return {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': TTS_CLIENT_CACHE_HEADER,
    'Accept-Ranges': 'bytes',
    'X-Cache': cacheStatus,
  };
}

/**
 * Dependency-injection seam for the upstream call. The vitest pool used by
 * this project does not expose `fetchMock`, so tests stub the upstream by
 * calling `makeHandleTts({ callElevenLabs: fakeFn })` and invoking the
 * returned handler directly (still via the real auth middleware).
 */
export interface TtsDeps {
  callElevenLabs: (params: ElevenLabsParams) => Promise<Response>;
}

const DEFAULT_DEPS: TtsDeps = { callElevenLabs: streamFromElevenLabs };

export function makeHandleTts(deps: TtsDeps = DEFAULT_DEPS) {
  return (req: Request, env: Env, ctx: ExecutionContext): Promise<Response> =>
    runTts(req, env, ctx, deps);
}

/** Default-deps handler used by the production router. */
export const handleTts = makeHandleTts();

async function runTts(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
  deps: TtsDeps,
): Promise<Response> {
  await requireAuth(req, env);

  await withDb(env, (db) =>
    checkRateLimit(db, TTS_RATE_BUCKET, RATE_LIMIT_TTS_PER_MIN, RATE_LIMIT_TTS_WINDOW_S),
  );

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('invalid JSON body');
  }
  const parsed = TtsRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('invalid tts request', parsed.error.issues);
  }
  const { text } = parsed.data;

  const voiceId = env.ELEVENLABS_VOICE_ID;
  const hashHex = await sha256Hex(`${voiceId}|${text}`);
  const cacheKey = buildCacheKey(voiceId, hashHex);

  // ---- Cache lookup ------------------------------------------------------
  let cached: R2ObjectBody | null = null;
  try {
    cached = await env.AUDIO_CACHE.get(cacheKey);
  } catch (err) {
    // Treat read errors as a miss; the upstream path will still serve the user.
    log.warn('tts_cache_read_failed', { error: err, cacheKey });
  }
  if (cached !== null) {
    log.info('tts_cache_hit', { cacheKey, text_len: text.length });
    return new Response(cached.body, {
      status: 200,
      headers: audioResponseHeaders('HIT'),
    });
  }

  // ---- Upstream + tee for cache write ------------------------------------
  const upstream = await deps.callElevenLabs({
    apiKey: env.ELEVENLABS_API_KEY,
    voiceId,
    text,
  });
  if (upstream.body === null) {
    return errorResponse(502, 'tts_upstream', 'no body');
  }
  const [forClient, forCache] = upstream.body.tee();

  ctx.waitUntil(
    env.AUDIO_CACHE
      .put(cacheKey, forCache, {
        httpMetadata: { contentType: 'audio/mpeg' },
      })
      .then(() => {
        log.info('tts_cache_write', { cacheKey, text_len: text.length });
      })
      .catch((err: unknown) => {
        log.warn('tts_cache_write_failed', { error: err, cacheKey });
      }),
  );

  return new Response(forClient, {
    status: 200,
    headers: audioResponseHeaders('MISS'),
  });
}
