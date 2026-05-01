import type { Env } from './env';
import { errorResponse } from './lib/responses';
import { Router } from './lib/router';
import { toErrorResponse } from './lib/errors';
import { CORS_ALLOWED_ORIGINS } from './config';
import { handleHealth } from './routes/health';
import { handleAuthPin, handleAuthStatus } from './routes/auth';
import { handleChat } from './routes/chat';
import { handleState } from './routes/state';
import { handleCardPatch, handleCards } from './routes/cards';

/**
 * Worker entrypoint.
 *
 * Three layers:
 *   1. CORS preflight + origin allowlisting (this file).
 *   2. Route dispatch via the small `Router` class (`lib/router.ts`).
 *   3. Centralized error mapping (`toErrorResponse` in `lib/errors.ts`).
 *
 * Routes throw typed errors and return success bodies; this file applies
 * CORS to whatever comes back. The CORS allowlist comes from `env.ALLOWED_ORIGIN`
 * when set (Stage 5 production config) and falls back to the localhost dev
 * origin so `wrangler dev` keeps working out-of-box.
 */

const router = new Router()
  .add('GET', '/api/health', handleHealth)
  .add('POST', '/api/auth/pin', handleAuthPin)
  .add('GET', '/api/auth/status', handleAuthStatus)
  .add('POST', '/api/chat', handleChat)
  .add('GET', '/api/state', handleState)
  .add('GET', '/api/cards', handleCards)
  .add('PATCH', '/api/cards/:id', handleCardPatch);

/**
 * Build the CORS allowlist. `http://localhost:8788` is always included so
 * an operator who sets `ALLOWED_ORIGIN` in `wrangler.toml` doesn't break
 * direct local browser→Worker access while debugging. Production
 * non-proxy access still works because `ALLOWED_ORIGIN` is also in the
 * list; production proxy access is server-to-server and bypasses CORS.
 */
function getAllowedOrigins(env: Env): ReadonlyArray<string> {
  const list = [...CORS_ALLOWED_ORIGINS];
  if (env.ALLOWED_ORIGIN !== undefined && env.ALLOWED_ORIGIN.length > 0) {
    list.unshift(env.ALLOWED_ORIGIN);
  }
  return list;
}

function buildCorsHeaders(
  origin: string | null,
  allowedOrigins: ReadonlyArray<string>,
): Record<string, string> {
  if (origin === null || !allowedOrigins.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function applyCors(response: Response, cors: Record<string, string>): Response {
  if (Object.keys(cors).length === 0) return response;
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = buildCorsHeaders(request.headers.get('Origin'), getAllowedOrigins(env));

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    let response: Response;
    try {
      const dispatched = await router.dispatch(request, env, ctx);
      response = dispatched ?? errorResponse(404, 'not_found');
    } catch (err) {
      response = toErrorResponse(err, url.pathname);
    }
    return applyCors(response, cors);
  },
} satisfies ExportedHandler<Env>;
