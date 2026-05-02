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
    const childRoutes = childRouter.routes;
    const childRouteCount = childRoutes.length;
    for (let routeIndex = 0; routeIndex < childRouteCount; routeIndex += 1) {
      const route = childRoutes[routeIndex];
      if (!route) continue;

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

  /**
   * Serve static files from a directory.
   * Only responds if the file exists on disk, allowing fall-through.
   *
   * @param prefix The URL prefix (e.g. "/public")
   * @param root   The local directory path (e.g. "./public")
   */
  static(prefix: string, root: string) {
    const cleanPrefix = prefix === "/" ? "" : prefix.replace(/\/$/, "");
    const cleanRoot = root.replace(/\/$/, "");

    // Use GET for static file serving
    this.get(cleanPrefix + "/*", async (ctx) => {
      const subPath = ctx.params["_wildcard"] || "";

      // Basic security: prevent path traversal
      if (subPath.includes("..")) return;

      const filePath = cleanRoot + (subPath || "/index.html");
      const file = Bun.file(filePath);

      if (await file.exists()) {
        ctx.file(filePath);
      }
    });
  }

  // ─── Route Registration ───────────────────────────────────

  get(path: string, ...handlers: RouteHandler[]) {
    this.add("GET", path, handlers);
  }
  post(path: string, ...handlers: RouteHandler[]) {
    this.add("POST", path, handlers);
  }
  put(path: string, ...handlers: RouteHandler[]) {
    this.add("PUT", path, handlers);
  }
  patch(path: string, ...handlers: RouteHandler[]) {
    this.add("PATCH", path, handlers);
  }
  delete(path: string, ...handlers: RouteHandler[]) {
    this.add("DELETE", path, handlers);
  }
  options(path: string, ...handlers: RouteHandler[]) {
    this.add("OPTIONS", path, handlers);
  }
  head(path: string, ...handlers: RouteHandler[]) {
    this.add("HEAD", path, handlers);
  }
  all(path: string, ...handlers: RouteHandler[]) {
    const methods = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
      "HEAD",
    ];

    for (const method of methods) {
      this.add(method, path, handlers);
    }
  }

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
    // Replace :param with a named capture group
    let regexStr = "^" + path.replace(/:([a-zA-Z0-9_]+)/g, "(?<$1>[^/]+)");

    // Support terminal wildcards: /* (matches /foo/bar) or * (matches everything)
    if (regexStr.endsWith("/*")) {
      // Matches /prefix OR /prefix/anything
      regexStr = regexStr.slice(0, -2) + "(?<_wildcard>/.*)?";
    } else if (regexStr.endsWith("*")) {
      regexStr = regexStr.slice(0, -1) + "(?<_wildcard>.*)";
    }

    regexStr += "$";
    return new RegExp(regexStr);
  }

  // ─── Plugin Installation ──────────────────────────────────

  install(app: Runtime): void {
    app.engine.add({
      name: "router",
      run: async (ctx: Context) => {
        const url = new URL(ctx.req.url);
        const method = ctx.req.method;
        const routes = this.routes;
        const routeCount = routes.length;
        for (let routeIndex = 0; routeIndex < routeCount; routeIndex += 1) {
          const route = routes[routeIndex];
          if (!route) continue;

          if (route.method !== method) continue;

          const match = route.regex.exec(url.pathname);
          if (!match) continue;

          // Populate context params with regex capture groups
          ctx.params = match.groups || {};

          // Execute all handlers for this route sequentially
          for (
            let handlerIndex = 0;
            handlerIndex < route.handlers.length;
            handlerIndex += 1
          ) {
            const handler = route.handlers[handlerIndex];
            if (!handler) continue;
            await handler(ctx);

            // If a middleware responded or stopped the flow, halt the chain
            if (ctx.hasResponded() || ctx.isStopped()) return;
          }

          // If the route handlers responded or stopped the flow, we are done.
          // Otherwise, allow fall-through to see if other routes match.
          if (ctx.hasResponded() || ctx.isStopped()) return;
        }

        // If no route matched, engine continues natively to next step
      },
    });
  }
}
