import type { Env } from '../env';
import { json } from '../lib/responses';
import { ValidationError } from '../lib/errors';
import { PinRequestSchema } from '../schemas';
import {
  createSessionCookie,
  getClientIp,
  verifyPin,
  verifySession,
} from '../lib/auth';
import { withDb } from '../lib/db';
import { checkRateLimit } from '../lib/rate-limit';
import {
  RATE_LIMIT_PIN_PER_5MIN,
  RATE_LIMIT_PIN_WINDOW_S,
} from '../config';
import { log } from '../lib/logger';

/**
 * POST /api/auth/pin
 *
 * Body: { pin: string }
 * Success: 200 { ok: true } + Set-Cookie: htsess=...
 * Wrong PIN: 401 { error: "auth_failed" }
 * Bucket exceeded: 429 (RateLimitError handled by central mapper)
 *
 * Rate limit is per IP, counted on every attempt regardless of outcome.
 * Counted before validation so a malformed body still consumes a slot
 * (otherwise an attacker could brute-force PINs by sending invalid JSON).
 */
export async function handleAuthPin(req: Request, env: Env): Promise<Response> {
  const ip = getClientIp(req);

  await withDb(env, (db) =>
    checkRateLimit(db, `auth:pin:${ip}`, RATE_LIMIT_PIN_PER_5MIN, RATE_LIMIT_PIN_WINDOW_S),
  );

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('invalid JSON body');
  }
  const parsed = PinRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('invalid pin request', parsed.error.issues);
  }

  const ok = await verifyPin(parsed.data.pin, env.PIN_HASH);
  if (!ok) {
    log.warn('auth_pin_failed', { ip });
    return json({ error: 'auth_failed' }, { status: 401 });
  }

  const cookie = await createSessionCookie(env.SESSION_SECRET);
  log.info('auth_pin_success', { ip });
  return json({ ok: true }, { headers: { 'Set-Cookie': cookie } });
}

/**
 * GET /api/auth/status
 *
 * Always 200. Used by the frontend to decide whether to show the PIN screen.
 * Never throws — failures inside `verifySession` are treated as "not logged in".
 */
export async function handleAuthStatus(req: Request, env: Env): Promise<Response> {
  const authenticated = await verifySession(
    req.headers.get('Cookie'),
    env.SESSION_SECRET,
  );
  return json({ authenticated });
}
