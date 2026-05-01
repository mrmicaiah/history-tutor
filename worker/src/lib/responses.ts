/**
 * JSON response helpers for the Worker.
 *
 * All Worker responses must use these helpers so that:
 *   - Content-Type is always `application/json; charset=utf-8`
 *   - CORS headers are set consistently
 *   - Error responses have a stable `{ error: <code>, message?: <human> }` shape
 *
 * CORS is permissive in Stage 1 because the frontend does not exist yet.
 * Stage 2 will tighten it to the production Pages origin.
 */

const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json; charset=utf-8',
  ...CORS_HEADERS,
};

/**
 * Serialize `data` as a JSON response. Caller-supplied headers in `init.headers`
 * override the defaults on a per-key basis.
 */
export function json<T>(data: T, init: ResponseInit = {}): Response {
  const headers = new Headers(BASE_HEADERS);
  if (init.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    statusText: init.statusText ?? '',
    headers,
  });
}

/**
 * Build a structured error response.
 *
 * `code` is a stable machine-readable identifier (snake_case). `message` is an
 * optional human-readable description. NEVER pass raw exception messages here:
 * they may leak internal details. Log the exception server-side and return a
 * generic message instead.
 */
export function errorResponse(
  status: number,
  code: string,
  message?: string,
): Response {
  const body: { error: string; message?: string } = { error: code };
  if (message !== undefined) {
    body.message = message;
  }
  return json(body, { status });
}
