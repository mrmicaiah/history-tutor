import type { Env } from './env';
import { errorResponse } from './lib/responses';
import { Router } from './lib/router';
import { toErrorResponse } from './lib/errors';
import { CORS_ALLOWED_ORIGINS } from './config';
import { handleHealth } from './routes/health';
import { handleAuthPin, handleAuthStatus } from './routes/auth';
import { handleChat } from './routes/chat';

/**
 * Worker entrypoint.
 *
 * Responsibilities live in three layers:
 *   1. CORS preflight + origin allowlisting (this file).
 *   2. Route dispatch via the small `Router` class (`lib/router.ts`).
 *   3. Centralized error mapping (`toErrorResponse` in `lib/errors.ts`).
 *
 * Routes themselves never build error responses or set CORS headers — they
 * `throw` typed errors and return success bodies; this file applies CORS to
 * whatever comes back.
 */

const router = new Router()
  .add('GET', '/api/health', handleHealth)
  .add('POST', '/api/auth/pin', handleAuthPin)
  .add('GET', '/api/auth/status', handleAuthStatus)
  .add('POST', '/api/chat', handleChat);

/**
 * Build CORS headers for the given Origin. Returns an empty object when the
 * origin is not in the allowlist (or when the request is non-CORS, i.e. has
 * no Origin header). When non-empty, includes credentials + a Vary on Origin
 * so caches don't leak headers across origins.
 */
function buildCorsHeaders(origin: string | null): Record<string, string> {
  if (origin === null || !CORS_ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
    const cors = buildCorsHeaders(request.headers.get('Origin'));

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
