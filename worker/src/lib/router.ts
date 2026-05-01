import type { Env } from '../env';

/**
 * Tiny router with `:param`-style path matching.
 *
 * Patterns: literal segments + `:name` placeholders. No wildcards, no regex,
 * no nested routers. Examples:
 *   `/api/health`
 *   `/api/cards/:id`
 *
 * Parameters are passed to handlers as a `Record<string, string>`. Handlers
 * that don't need params can ignore the 4th argument.
 */

export type RouteHandler = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
) => Promise<Response>;

interface Route {
  method: string;
  pattern: string;
  handler: RouteHandler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): this {
    this.routes.push({ method, pattern, handler });
    return this;
  }

  async dispatch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response | null> {
    const url = new URL(request.url);
    for (const route of this.routes) {
      if (route.method !== request.method) continue;
      const params = matchPath(route.pattern, url.pathname);
      if (params !== null) {
        return route.handler(request, env, ctx, params);
      }
    }
    return null;
  }
}

/**
 * Match `pathname` against a `:param`-style pattern. Returns the parsed
 * params on match, `null` otherwise. Both pattern and pathname are
 * leading-slash-anchored and must have the same number of segments.
 */
function matchPath(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i]!;
    const v = pathParts[i]!;
    if (p.startsWith(':')) {
      params[p.slice(1)] = decodeURIComponent(v);
    } else if (p !== v) {
      return null;
    }
  }
  return params;
}
