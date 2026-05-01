/**
 * Structured JSON logger.
 *
 * Cloudflare's `wrangler tail` and the dashboard logs surface anything written
 * to stdout. We emit one JSON object per call so log aggregation downstream
 * can parse without regex gymnastics.
 *
 * This module is the ONLY place in the codebase where `console.log` may be
 * called. Adding logging to a route or lib file means importing `log` from
 * here, never reaching for `console` directly.
 *
 * Secret redaction: any context key that matches the redact regex
 * (api key / secret / pin / token / cookie) is replaced with the literal
 * string "[REDACTED]" before serialization. Redaction recurses into nested
 * objects and arrays so a logger call like
 *   log.info('msg', { request: { body: { pin: '1234' } } })
 * still scrubs the inner field.
 */

type LogLevel = 'info' | 'warn' | 'error';

const REDACT_KEY_RE = /api[_-]?key|secret|pin|token|cookie/i;
const REDACTED = '[REDACTED]' as const;

/**
 * Walks a value recursively, redacting any object property whose key matches
 * the redact regex and serializing Error instances into a loggable shape.
 */
function sanitize(value: unknown, key?: string): unknown {
  if (key !== undefined && REDACT_KEY_RE.test(key)) {
    return REDACTED;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitize(v));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitize(v, k);
    }
    return out;
  }
  return value;
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const record: Record<string, unknown> = {
    level,
    message,
    timestamp_ms: Date.now(),
  };
  if (context) {
    for (const [k, v] of Object.entries(context)) {
      record[k] = sanitize(v, k);
    }
  }
  // The single permitted console.log in the worker codebase.
  // eslint-disable-next-line no-console -- structured logger sink
  console.log(JSON.stringify(record));
}

export const log = {
  info(message: string, context?: Record<string, unknown>): void {
    emit('info', message, context);
  },
  warn(message: string, context?: Record<string, unknown>): void {
    emit('warn', message, context);
  },
  error(message: string, context?: Record<string, unknown>): void {
    emit('error', message, context);
  },
};
