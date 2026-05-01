import type { Env } from '../env';

/**
 * Tiny exact-match router. Method + pathname only, no parameters or wildcards
 * — this app's surface area is small enough that a 30-line router beats
 * pulling in itty-router or hono.
 *
 * The dispatcher returns `null` when no route matches so the caller can map
 * the no-match case to a 404 (and apply CORS uniformly).
 */

export type RouteHandler = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) => Promise<Response>;

interface Route {
  method: string;
  pathname: string;
  handler: RouteHandler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pathname: string, handler: RouteHandler): this {
    this.routes.push({ method, pathname, handler });
    return this;
  }

  async dispatch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response | null> {
    const url = new URL(request.url);
    for (const route of this.routes) {
      if (route.method === request.method && route.pathname === url.pathname) {
        return route.handler(request, env, ctx);
      }
    }
    return null;
  }
}
