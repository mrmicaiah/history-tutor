import { log } from './logger';
import { DatabaseError, RateLimitError } from './errors';
import type { DbContext } from './db';

/**
 * Simple SQL-backed rate limiter against the `rate_limit` table.
 *
 * A "bucket" is a `(bucketKey, time-window)` pair. Each call to
 * `checkRateLimit` UPSERTs the count for the current window's bucket and
 * throws `RateLimitError` if the post-increment count exceeds `max`.
 *
 * Bucket key examples:
 *   - "chat"               (single global limiter; we have one user)
 *   - "auth:pin:1.2.3.4"   (IP-keyed limiter for the PIN endpoint)
 *
 * The table is GC'd probabilistically (1% of calls trigger a sweep of rows
 * older than 24 hours), which keeps it from growing unbounded without
 * needing a Cron Trigger.
 *
 * Note: the spec sketched `(bucketKey, maxPerMinute)` but a literal
 * "per minute" interface can't express the PIN bucket's "5 per 5 minutes",
 * so we expose `windowSeconds` instead.
 */

const CLEANUP_PROBABILITY = 0.01;
const CLEANUP_AGE_MS = 24 * 60 * 60 * 1000;

/** Throws RateLimitError when the bucket has exceeded `max` in the window. */
export async function checkRateLimit(
  db: DbContext,
  bucketKey: string,
  max: number,
  windowSeconds: number,
): Promise<void> {
  const nowMs = Date.now();
  const windowIndex = Math.floor(nowMs / 1000 / windowSeconds);
  const bucket = `${bucketKey}:${windowIndex}`;

  let count: number;
  try {
    const row = await db.d1
      .prepare(
        `INSERT INTO rate_limit (bucket, count, created_at)
         VALUES (?1, 1, ?2)
         ON CONFLICT(bucket) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(bucket, nowMs)
      .first<{ count: number }>();
    if (row === null || typeof row.count !== 'number') {
      log.error('rate_limit_no_row', { bucket });
      throw new DatabaseError('rate limit upsert returned no row');
    }
    count = row.count;
  } catch (err) {
    if (err instanceof DatabaseError) throw err;
    log.error('rate_limit_threw', { error: err, bucket });
    throw new DatabaseError('rate limit check failed');
  }

  if (count > max) {
    const windowEndsAtMs = (windowIndex + 1) * windowSeconds * 1000;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowEndsAtMs - nowMs) / 1000));
    throw new RateLimitError(retryAfterSeconds);
  }

  if (Math.random() < CLEANUP_PROBABILITY) {
    const cutoff = nowMs - CLEANUP_AGE_MS;
    try {
      await db.d1
        .prepare('DELETE FROM rate_limit WHERE created_at < ?')
        .bind(cutoff)
        .run();
    } catch (err) {
      // Cleanup is best-effort; never fail the request because of it.
      log.warn('rate_limit_cleanup_failed', { error: err });
    }
  }
}
