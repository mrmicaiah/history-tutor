/**
 * Pages Function: transparent proxy for /api/* to the Worker.
 *
 * The browser only ever sees the Pages origin. The Function rewrites the
 * request URL to point at WORKER_URL and forwards everything else (method,
 * headers, body, cookies) unchanged. The Worker's response — including its
 * Set-Cookie headers — flows back unmodified.
 *
 * Why this matters for cookies:
 *   The Worker's `Set-Cookie` does not include a `Domain=` attribute (Stage 2
 *   default; only added when `COOKIE_DOMAIN` is set). When the response is
 *   delivered through this proxy, the browser sees it as coming from the
 *   Pages origin and scopes the cookie to that origin. Subsequent /api/*
 *   requests carry the cookie back over the proxy. No CORS, no cross-domain
 *   cookie gymnastics, no custom domain required.
 *
 * Why this is intentionally minimal:
 *   - No header rewriting (the Worker decides Vary, Cache-Control, etc.).
 *   - No body manipulation (JSON / streams pass through verbatim).
 *   - No caching (the Worker authorizes; caching here would be a foot-gun).
 *   The Worker is the source of truth for status codes, headers, and bodies.
 */

interface ProxyEnv {
  /** Origin of the deployed Worker, e.g. "https://history-tutor.<sub>.workers.dev". */
  WORKER_URL: string;
}

export const onRequest: PagesFunction<ProxyEnv> = async (context) => {
  const { request, env } = context;

  if (typeof env.WORKER_URL !== 'string' || env.WORKER_URL.length === 0) {
    return new Response(
      JSON.stringify({
        error: 'proxy_misconfigured',
        message: 'WORKER_URL is not set on this Pages deployment.',
      }),
      {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      },
    );
  }

  const incoming = new URL(request.url);
  const target = new URL(env.WORKER_URL);
  target.pathname = incoming.pathname;
  target.search = incoming.search;

  // `new Request(url, init)` with `init = Request` copies method, headers,
  // and body; replacing the URL is the only mutation we need.
  const proxied = new Request(target.toString(), request);
  return fetch(proxied);
};
