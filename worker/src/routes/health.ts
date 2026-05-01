import type { Env } from '../env';
import { json } from '../lib/responses';
import { log } from '../lib/logger';

const VERSION = 'stage-2';

type DbStatus = 'connected' | 'error';

async function probeDatabase(db: D1Database): Promise<DbStatus> {
  try {
    const row = await db.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    return row?.ok === 1 ? 'connected' : 'error';
  } catch (err) {
    log.error('db_health_check_failed', { error: err });
    return 'error';
  }
}

/** GET /api/health — liveness probe with DB binding check. */
export async function handleHealth(_req: Request, env: Env): Promise<Response> {
  const db = await probeDatabase(env.DB);
  return json({ ok: true, version: VERSION, db });
}
