/**
 * SinwanJS Core Runtime — Router Plugin
 *
 * A lightweight, regex-based router that supports URL parameters,
 * route-level middleware, and router groups.
 */

import type { Context } from "./context";
import type { Plugin } from "./types";
import type { Runtime } from "./runtime";

export type RouteHandler = (ctx: Context) => Promise<void> | void;

interface Route {
  method: string;
  path: string;
  regex: RegExp;
  handlers: RouteHandler[];
}

export class Router implements Plugin {
  public readonly name = "sinwan:router";
  private readonly routes: Route[] = [];
  
  // Router-level middleware applied to all routes added AFTER this is called
  private readonly middlewares: RouteHandler[] = [];

  // ─── Middleware & Grouping ────────────────────────────────

  /** Add router-level middleware. */
  use(...handlers: RouteHandler[]) {
    this.middlewares.push(...handlers);
  }

  /** Mount a group of routes under a prefix. */
  group(prefix: string, callback: (router: Router) => void) {
    const childRouter = new Router();
    
    // Execute the callback to populate the child router
    callback(childRouter);

    // Clean trailing slash from prefix if present
    const cleanPrefix = prefix === "/" ? "" : prefix.replace(/\/$/, "");

    for (const route of childRouter.routes) {
      // Merge paths safely
      let mergedPath = cleanPrefix + route.path;
      // Handle the case where prefix was / and child path was /
      if (mergedPath === "" || mergedPath === "//") mergedPath = "/";

      this.routes.push({
        method: route.method,
        path: mergedPath,
        regex: this.compilePathToRegex(mergedPath),
        // Prepend this router's middlewares to the child's handlers
        handlers: [...this.middlewares, ...route.handlers],
      });
    }
  }

  // ─── Route Registration ───────────────────────────────────

  get(path: string, ...handlers: RouteHandler[]) { this.add("GET", path, handlers); }
  post(path: string, ...handlers: RouteHandler[]) { this.add("POST", path, handlers); }
  put(path: string, ...handlers: RouteHandler[]) { this.add("PUT", path, handlers); }
  patch(path: string, ...handlers: RouteHandler[]) { this.add("PATCH", path, handlers); }
  delete(path: string, ...handlers: RouteHandler[]) { this.add("DELETE", path, handlers); }

  private add(method: string, path: string, routeHandlers: RouteHandler[]) {
    this.routes.push({
      method: method.toUpperCase(),
      path: path,
      regex: this.compilePathToRegex(path),
      // Combine router-level middleware with route-specific handlers
      handlers: [...this.middlewares, ...routeHandlers],
    });
  }

  private compilePathToRegex(path: string): RegExp {
    const regexStr = "^" + path.replace(/:([a-zA-Z0-9_]+)/g, "(?<$1>[^/]+)") + "$";
    return new RegExp(regexStr);
  }

  // ─── Plugin Installation ──────────────────────────────────

  install(app: Runtime): void {
    app.engine.add({
      name: "router",
      run: async (ctx: Context) => {
        const url = new URL(ctx.req.url);
        const method = ctx.req.method;

        for (const route of this.routes) {
          if (route.method !== method) continue;

          const match = route.regex.exec(url.pathname);
          if (match) {
            // Populate context params with regex capture groups
            ctx.params = match.groups || {};

            // Execute all handlers for this route sequentially
            for (const handler of route.handlers) {
              await handler(ctx);
              
              // If a middleware responded or stopped the flow, halt the chain
              if (ctx.hasResponded() || ctx.isStopped()) return;
            }

            // Route was fully matched and handled, stop routing
            return;
          }
        }
        
        // If no route matched, engine continues natively to next step
      },
    });
  }
}
