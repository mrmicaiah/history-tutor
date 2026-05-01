/**
 * JSON response helpers for the Worker.
 *
 * Sets `Content-Type: application/json; charset=utf-8` and serializes the
 * body. CORS headers are NOT applied here — the top-level dispatcher in
 * `index.ts` adds origin-allowlisted CORS to every response after route
 * handling, which keeps this helper agnostic to caller context (Set-Cookie,
 * Retry-After, etc. all flow through unchanged).
 *
 * Caller-supplied headers in `init.headers` override the defaults on a
 * per-key basis.
 */

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json; charset=utf-8',
};

/** Serialize `data` as a JSON Response. */
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
 * optional human-readable description. NEVER pass raw exception messages here
 * — log them server-side and return a generic message instead.
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
