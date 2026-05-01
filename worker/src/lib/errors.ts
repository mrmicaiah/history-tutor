import { json } from './responses';
import { log } from './logger';

/**
 * Application error hierarchy.
 *
 * Every recoverable failure mode in a route is one of these classes. Handlers
 * throw the appropriate subclass and never build response objects for error
 * cases themselves -- the central `toErrorResponse` helper does the mapping.
 *
 * Subclasses set:
 *   - `status` (HTTP status returned to the client)
 *   - `code`   (stable machine-readable identifier in the response body)
 *
 * `details` is reserved for ValidationError to carry the Zod issue list.
 * Internal-class errors (status >= 500) never expose `message` to the client;
 * the central handler logs them and returns a generic payload.
 */

export type ErrorPayload = { error: string; [k: string]: unknown };

export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }

  /** Override in subclasses that need to add fields beyond `error`. */
  toPayload(): ErrorPayload {
    return { error: this.code };
  }
}

/** 400 — input failed validation at the boundary. */
export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = 'validation';
  readonly details: unknown;

  constructor(message: string, details: unknown = null) {
    super(message);
    this.details = details;
  }

  override toPayload(): ErrorPayload {
    return { error: this.code, details: this.details };
  }
}

/** 401 — missing or invalid session. */
export class AuthError extends AppError {
  readonly status = 401;
  readonly code = 'auth_required';
}

/** 429 — request bucket exceeded. Carries `retry_after_seconds`. */
export class RateLimitError extends AppError {
  readonly status = 429;
  readonly code = 'rate_limited';
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`rate limited; retry in ${retryAfterSeconds}s`);
    this.retryAfterSeconds = retryAfterSeconds;
  }

  override toPayload(): ErrorPayload {
    return { error: this.code, retry_after_seconds: this.retryAfterSeconds };
  }
}

/** 500 — D1 query or PRAGMA call failed. Internal. */
export class DatabaseError extends AppError {
  readonly status = 500;
  readonly code = 'internal';
}

/** 502 — Anthropic returned non-2xx or invalid JSON. Internal. */
export class UpstreamError extends AppError {
  readonly status = 502;
  readonly code = 'upstream';
}

/** 504 — Anthropic exceeded the configured wall-clock timeout. */
export class TimeoutError extends AppError {
  readonly status = 504;
  readonly code = 'upstream_timeout';
}

/**
 * Map any thrown value to a Response. The single place every route's catch
 * boundary funnels through. Logs internal-class errors with the route name so
 * issues are diagnosable from `wrangler tail`.
 */
export function toErrorResponse(err: unknown, route: string): Response {
  if (err instanceof AppError) {
    if (err.status >= 500) {
      log.error('handler_error', { route, code: err.code, status: err.status, error: err });
    } else {
      log.warn('handler_error', { route, code: err.code, status: err.status, message: err.message });
    }
    if (err instanceof RateLimitError) {
      return json(err.toPayload(), {
        status: err.status,
        headers: { 'Retry-After': String(err.retryAfterSeconds) },
      });
    }
    return json(err.toPayload(), { status: err.status });
  }
  log.error('unhandled_error', { route, error: err });
  return json({ error: 'internal' }, { status: 500 });
}
