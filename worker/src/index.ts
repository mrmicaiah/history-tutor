import type { Env } from './env';
import { errorResponse, json } from './lib/responses';

/**
 * Version label returned by `/api/health`. Bumped per stage so the frontend
 * (and humans) can confirm which build is live without checking commit hashes.
 */
const VERSION = 'stage-1';

type DbStatus = 'connected' | 'error';

/**
 * Probe the D1 binding with a trivial `SELECT 1` to confirm the binding is
 * wired and the database is reachable. Errors are logged server-side and
 * surfaced to the caller only as the opaque string `"error"`. We never echo
 * exception messages — they can leak schema details or internal infrastructure.
 *
 * NOTE: `console.error` is used here as a placeholder. Stage 2 introduces a
 * structured logger that this call site will switch to.
 */
async function checkDatabase(db: D1Database): Promise<DbStatus> {
  try {
    const row = await db.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    return row?.ok === 1 ? 'connected' : 'error';
  } catch (err) {
    console.error('db_health_check_failed', err);
    return 'error';
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      const db = await checkDatabase(env.DB);
      return json({ ok: true, version: VERSION, db });
    }

    return errorResponse(404, 'not_found');
  },
} satisfies ExportedHandler<Env>;
