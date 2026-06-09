/**
 * SinwanJS Core Runtime — HTTPRouter Plugin
 *
 * Radix-tree HTTPRouter with static fastpath, ALL bucket fallback,
 * and manual URL parsing for lower overhead.
 */

import type { Context } from "../context/context";
import type { Plugin } from "../types";
import type { Runtime } from "../runtime";
import * as path from "node:path";

export type RouteHandler = (ctx: Context) => Promise<void> | void;

const SPECIFIC_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
] as const;

type SpecificMethod = (typeof SPECIFIC_METHODS)[number];
type HttpMethod = SpecificMethod | "ALL";

const SPECIFIC_METHODS_SET = new Set<string>(SPECIFIC_METHODS);

function isSpecificMethod(method: string): method is SpecificMethod {
  return SPECIFIC_METHODS_SET.has(method);
}

interface HttpRoute {
  method: HttpMethod;
  path: string;
  handlers: RouteHandler[];
}

interface RadixNode {
  prefix: string;
  children: RadixNode[];
  isParam: boolean;
  paramName: string;
  isWildcard: boolean;
  handlers: Partial<Record<HttpMethod, RouteHandler[]>>;
}

function createRadixNode(prefix: string): RadixNode {
  return {
    prefix,
    children: [],
    isParam: prefix.startsWith(":"),
    paramName: prefix.startsWith(":") ? prefix.slice(1) : "",
    isWildcard: prefix === "*",
    handlers: {},
  };
}

// Helper for zero-prototype empty params object.
function createEmptyParams(): Record<string, string> {
  return Object.create(null);
}

// Fast key-by-key copy — cheaper than spread (avoids iterator protocol).
function copyParams(src: Record<string, string>): Record<string, string> {
  const dst: Record<string, string> = Object.create(null);
  for (const key in src) dst[key] = src[key]!;
  return dst;
}

function addHandlers(
  node: RadixNode,
  method: HttpMethod,
  handlers: RouteHandler[],
): void {
  const current = node.handlers[method];
  if (current) {
    node.handlers[method] = [...current, ...handlers];
  } else {
    node.handlers[method] = handlers;
  }
}

function getHandlers(
  node: RadixNode,
  method: HttpMethod,
): RouteHandler[] | null {
  return node.handlers[method] ?? null;
}

function nodeHasAnyHandlers(node: RadixNode): boolean {
  for (const key in node.handlers) {
    const bucket = node.handlers[key as HttpMethod];
    if (bucket && bucket.length > 0) return true;
  }
  return false;
}

function normalizePath(path: string): string {
  if (path === "") return "/";
  if (path.length > 1 && path.charCodeAt(path.length - 1) === 47) {
    return path.slice(0, -1);
  }
  return path;
}

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

const PATH_INDICES = { start: 0, end: 0 };

function setPathnameIndices(url: string): void {
  let start = 0;
  const protoIdx = url.indexOf("://");
  if (protoIdx !== -1) {
    start = url.indexOf("/", protoIdx + 3);
    if (start === -1) {
      PATH_INDICES.start = 0;
      PATH_INDICES.end = 0;
      return;
    }
  }

  let end = url.length;
  for (let i = start; i < url.length; i += 1) {
    const cc = url.charCodeAt(i);
    if (cc === 63 || cc === 35) {
      end = i;
      break;
    }
  }

  if (end - start > 1 && url.charCodeAt(end - 1) === 47) {
    end -= 1;
  }

  PATH_INDICES.start = start;
  PATH_INDICES.end = end;
}

function segmentPathRaw(url: string, start: number, end: number): number {
  segCount = 0;
  let s = url.charCodeAt(start) === 47 ? start + 1 : start;
  for (let i = s; i <= end; i += 1) {
    if (i === end || url.charCodeAt(i) === 47) {
      if (i > s) SEG_BUFFER[segCount++] = url.slice(s, i);
      s = i + 1;
    }
  }
  return segCount;
}

// Pre-allocated segment buffer for request paths
const SEG_BUFFER: string[] = new Array(64);
let segCount = 0;

function segmentPath(pathname: string): number {
  segCount = 0;
  let start = pathname.charCodeAt(0) === 47 ? 1 : 0;
  for (let i = start; i <= pathname.length; i += 1) {
    if (i === pathname.length || pathname.charCodeAt(i) === 47) {
      if (i > start) SEG_BUFFER[segCount++] = pathname.slice(start, i);
      start = i + 1;
    }
  }
  return segCount;
}

function clearParams(params: Record<string, string>): void {
  for (const key in params) delete params[key];
}

function wildcardValue(
  segments: string[],
  depth: number,
  segCount: number,
): string {
  let rest = "";
  const append = (value: string) => {
    if (value === "") return;
    if (rest === "") rest = value;
    else rest += `/${value}`;
  };

  for (let i = depth; i < segCount; i += 1) {
    const seg = segments[i];
    if (seg !== undefined) append(seg);
  }

  return rest ? `/${rest}` : "";
}

// ── Radix Insert ──────────────────────────────────────────────

function radixInsert(
  root: RadixNode,
  segments: string[],
  depth: number,
  method: HttpMethod,
  handlers: RouteHandler[],
): void {
  if (depth === segments.length) {
    addHandlers(root, method, handlers);
    return;
  }

  const seg = segments[depth];
  if (seg === undefined) return;

  if (seg === "*") {
    let wildcardChild = root.children.find((child) => child.isWildcard);
    if (!wildcardChild) {
      wildcardChild = createRadixNode("*");
      root.children.push(wildcardChild);
    }
    addHandlers(wildcardChild, method, handlers);
    return;
  }

  if (seg.startsWith(":")) {
    const paramName = seg.slice(1);
    let paramChild = root.children.find(
      (child) => child.isParam && child.paramName === paramName,
    );
    if (!paramChild) {
      paramChild = createRadixNode(seg);
      root.children.push(paramChild);
    }
    radixInsert(paramChild, segments, depth + 1, method, handlers);
    return;
  }

  for (const child of root.children) {
    if (child.isParam || child.isWildcard) continue;
    if (child.prefix !== seg) continue;
    radixInsert(child, segments, depth + 1, method, handlers);
    return;
  }

  const newNode = createRadixNode(seg);
  root.children.push(newNode);
  radixInsert(newNode, segments, depth + 1, method, handlers);
}

// ── Radix Search ──────────────────────────────────────────────

function radixSearch(
  node: RadixNode,
  segments: string[],
  segCount: number,
  depth: number,
  method: HttpMethod,
  params: Record<string, string>,
): RouteHandler[] | null {
  if (depth === segCount) {
    const direct = getHandlers(node, method);
    if (direct) return direct;

    const wildcardChild = node.children.find((child) => child.isWildcard);
    if (wildcardChild) {
      params["_wildcard"] = "";
      return getHandlers(wildcardChild, method);
    }

    return null;
  }

  const seg = segments[depth];
  if (seg === undefined) return null;

  for (const child of node.children) {
    if (child.isParam || child.isWildcard) continue;

    if (child.prefix !== seg) continue;
    const found = radixSearch(
      child,
      segments,
      segCount,
      depth + 1,
      method,
      params,
    );
    if (found) return found;
  }

  for (const child of node.children) {
    if (!child.isParam) continue;

    params[child.paramName] = seg;
    const found = radixSearch(
      child,
      segments,
      segCount,
      depth + 1,
      method,
      params,
    );
    if (found) return found;
    delete params[child.paramName];
  }

  for (const child of node.children) {
    if (!child.isWildcard) continue;
    params["_wildcard"] = wildcardValue(segments, depth, segCount);
    return getHandlers(child, method);
  }

  return null;
}

function radixHasAnyMethod(
  node: RadixNode,
  segments: string[],
  segCount: number,
  depth: number,
): boolean {
  if (depth === segCount) {
    if (nodeHasAnyHandlers(node)) return true;
    const wildcardChild = node.children.find((child) => child.isWildcard);
    return wildcardChild ? nodeHasAnyHandlers(wildcardChild) : false;
  }

  const seg = segments[depth];
  if (seg === undefined) return false;

  for (const child of node.children) {
    if (child.isParam || child.isWildcard) continue;

    if (child.prefix !== seg) continue;
    if (radixHasAnyMethod(child, segments, segCount, depth + 1)) return true;
  }

  for (const child of node.children) {
    if (!child.isParam) continue;
    if (radixHasAnyMethod(child, segments, segCount, depth + 1)) return true;
  }

  for (const child of node.children) {
    if (!child.isWildcard) continue;
    return nodeHasAnyHandlers(child);
  }

  return false;
}

export class HTTPRouter implements Plugin {
  public readonly name = "sinwan:http-router";

  // Used by group() and debug tooling; private but preserved for compatibility.
  private readonly routes: HttpRoute[] = [];

  // HTTPRouter-level middleware applied to all routes added AFTER this is called
  private readonly middlewares: RouteHandler[] = [];

  private readonly staticRoutes: Record<
    SpecificMethod,
    Map<string, RouteHandler[]>
  > = {
    GET: new Map(),
    POST: new Map(),
    PUT: new Map(),
    PATCH: new Map(),
    DELETE: new Map(),
    OPTIONS: new Map(),
    HEAD: new Map(),
  };

  private readonly staticAll: Map<string, RouteHandler[]> = new Map();

  private readonly radix: Record<SpecificMethod, RadixNode> = {
    GET: createRadixNode(""),
    POST: createRadixNode(""),
    PUT: createRadixNode(""),
    PATCH: createRadixNode(""),
    DELETE: createRadixNode(""),
    OPTIONS: createRadixNode(""),
    HEAD: createRadixNode(""),
  };

  private readonly radixAll: RadixNode = createRadixNode("");

  // ─── Middleware & Grouping ────────────────────────────────

  /** Add HTTPRouter-level middleware. */
  use(...handlers: RouteHandler[]) {
    this.middlewares.push(...handlers);
  }

  /** Mount a group of routes under a prefix. */
  group(prefix: string, callback: (HTTPRouter: HTTPRouter) => void) {
    const childRouter = new HTTPRouter();
    callback(childRouter);
    this.mount(prefix, childRouter);
  }

  /** Mount an existing HTTPRouter instance under a prefix. */
  mount(prefix: string, HTTPRouter: HTTPRouter) {
    const cleanPrefix = prefix === "/" ? "" : prefix.replace(/\/$/, "");
    // Use the public routes property if available, otherwise fallback
    // We cast to access private routes for internal mounting
    const childRoutes = (HTTPRouter as any).routes as HttpRoute[];
    const childRouteCount = childRoutes.length;
    for (let routeIndex = 0; routeIndex < childRouteCount; routeIndex += 1) {
      const route = childRoutes[routeIndex];
      if (!route) continue;

      let mergedPath = cleanPrefix + route.path;
      if (mergedPath === "" || mergedPath === "//") mergedPath = "/";

      this.add(route.method, mergedPath, route.handlers);
    }
  }

  /**
   * Serve static files from a directory.
   * Only responds if the file exists on disk, allowing fall-through.
   *
   * Security: Uses path.relative() to detect ALL traversal attempts including
   * URL-encoded sequences, double encoding, and mixed encoding attacks.
   *
   * @param prefix The URL prefix (e.g. "/public")
   * @param root   The local directory path (e.g. "./public")
   */
  static(prefix: string, root: string) {
    const cleanPrefix = prefix === "/" ? "" : prefix.replace(/\/$/, "");
    const cleanRoot = path.resolve(root.replace(/\/$/, ""));

    this.get(cleanPrefix + "/*", async (ctx) => {
      const subPath = ctx.params["_wildcard"] || "";
      if (subPath === "") return;

      // Security: Decode URL-encoded sequences (handles %2e%2e%2f, etc.)
      let decodedPath: string;
      try {
        // Decode multiple times to catch double/triple encoding attacks
        decodedPath = subPath;
        let prev = "";
        while (prev !== decodedPath) {
          prev = decodedPath;
          decodedPath = decodeURIComponent(decodedPath);
        }
      } catch {
        // Invalid encoding - reject
        return;
      }

      // Security: Reject any path containing traversal sequences
      // This catches both encoded and decoded ".." attempts
      if (decodedPath.includes("..") || decodedPath.includes("\0")) {
        return;
      }

      // Build the full path
      const normalizedSubPath = decodedPath.startsWith("/")
        ? decodedPath.slice(1)
        : decodedPath;
      const filePath = path.resolve(cleanRoot, normalizedSubPath);

      // Security: Use path.relative() to detect if the resolved path escapes root
      // If the relative path starts with "..", it's outside the allowed directory
      const relativePath = path.relative(cleanRoot, filePath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return;
      }

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
    this.add("ALL", path, handlers);
  }

  private add(method: HttpMethod, path: string, handlers: RouteHandler[]) {
    const normalized = normalizePath(path);
    const finalHandlers = [...this.middlewares, ...handlers];

    this.routes.push({ method, path: normalized, handlers: finalHandlers });

    const hasParamsOrWildcard =
      normalized.includes(":") || normalized.includes("*");

    if (method === "ALL") {
      if (!hasParamsOrWildcard) {
        const current = this.staticAll.get(normalized);
        if (current)
          this.staticAll.set(normalized, [...current, ...finalHandlers]);
        else this.staticAll.set(normalized, finalHandlers);
      } else {
        const segments = splitPath(normalized);
        radixInsert(this.radixAll, segments, 0, "ALL", finalHandlers);
      }
      return;
    }

    if (!hasParamsOrWildcard) {
      const current = this.staticRoutes[method].get(normalized);
      if (current)
        this.staticRoutes[method].set(normalized, [
          ...current,
          ...finalHandlers,
        ]);
      else this.staticRoutes[method].set(normalized, finalHandlers);
      return;
    }

    const segments = splitPath(normalized);
    radixInsert(this.radix[method], segments, 0, method, finalHandlers);
  }

  // ─── Resolution ───────────────────────────────────────────

  public resolve(
    method: string,
    url: string,
    start: number,
    end: number,
  ):
    | {
        type: "match";
        source: "specific" | "all";
        handlers: RouteHandler[];
        params: Record<string, string>;
      }
    | { type: "method-not-allowed" }
    | null {
    const m = isSpecificMethod(method) ? method : undefined;

    // Attempt static lookup first without slicing if possible
    // Wait, Maps need the string key. So we still need ONE slice if we use Maps.
    // BUT we can use a trie for everything or a specialized cache.
    const pathname = url.slice(start, end) || "/";

    let segCount = -1;
    const segs = SEG_BUFFER;
    const ensureSegments = () => {
      if (segCount === -1) segCount = segmentPathRaw(url, start, end);
      return segCount;
    };

    // 1) Exact method match
    if (m) {
      const staticBucket = this.staticRoutes[m].get(pathname);
      if (staticBucket) {
        return {
          type: "match",
          source: "specific",
          handlers: staticBucket,
          params: createEmptyParams(),
        };
      }

      const params: Record<string, string> = Object.create(null);
      const count = ensureSegments();
      const handlerBucket = radixSearch(
        this.radix[m],
        segs,
        count,
        0,
        m,
        params,
      );
      if (handlerBucket) {
        return {
          type: "match",
          source: "specific",
          handlers: handlerBucket,
          params: copyParams(params),
        };
      }

      // 2) HEAD fallback to GET
      if (m === "HEAD") {
        const getStatic = this.staticRoutes.GET.get(pathname);
        if (getStatic) {
          return {
            type: "match",
            source: "specific",
            handlers: getStatic,
            params: createEmptyParams(),
          };
        }

        clearParams(params);
        const count = ensureSegments();
        const getBucket = radixSearch(
          this.radix.GET,
          segs,
          count,
          0,
          "GET",
          params,
        );
        if (getBucket) {
          return {
            type: "match",
            source: "specific",
            handlers: getBucket,
            params: copyParams(params),
          };
        }
      }
    }

    // 3) ALL bucket fallback
    const allStatic = this.staticAll.get(pathname);
    if (allStatic) {
      return {
        type: "match",
        source: "all",
        handlers: allStatic,
        params: createEmptyParams(),
      };
    }

    const params: Record<string, string> = Object.create(null);
    const count = ensureSegments();
    const allBucket = radixSearch(this.radixAll, segs, count, 0, "ALL", params);
    if (allBucket) {
      return {
        type: "match",
        source: "all",
        handlers: allBucket,
        params: copyParams(params),
      };
    }

    // 4) 405 detection
    const routeExists =
      SPECIFIC_METHODS.some(
        (sm) =>
          this.staticRoutes[sm].has(pathname) ||
          radixHasAnyMethod(this.radix[sm], segs, ensureSegments(), 0),
      ) ||
      this.staticAll.has(pathname) ||
      radixHasAnyMethod(this.radixAll, segs, ensureSegments(), 0);

    if (routeExists) return { type: "method-not-allowed" };

    return null;
  }

  private resolveAll(
    pathname: string,
  ): { handlers: RouteHandler[]; params: Record<string, string> } | null {
    const allStatic = this.staticAll.get(pathname);
    if (allStatic) {
      return { handlers: allStatic, params: createEmptyParams() };
    }

    const params: Record<string, string> = Object.create(null);
    const count = segmentPath(pathname);
    const allBucket = radixSearch(
      this.radixAll,
      SEG_BUFFER,
      count,
      0,
      "ALL",
      params,
    );
    if (allBucket) {
      return { handlers: allBucket, params: copyParams(params) };
    }

    return null;
  }

  // ─── Static handler chain runner ─────────────────────────

  private static runChain(
    ctx: Context,
    chain: RouteHandler[],
    onError?: (error: unknown) => Promise<void> | void,
  ): void | Promise<void> {
    const len = chain.length;
    for (let i = 0; i < len; i += 1) {
      const handler = chain[i];
      if (!handler) continue;
      const result = handler(ctx);
      if (result instanceof Promise) {
        return (async () => {
          try {
            await result;
            if (ctx.hasResponded() || ctx.isStopped()) return;
            for (let j = i + 1; j < len; j += 1) {
              const h = chain[j];
              if (h) await h(ctx);
              if (ctx.hasResponded() || ctx.isStopped()) return;
            }
          } catch (error) {
            if (onError) {
              await onError(error);
              return;
            }
            throw error;
          }
        })();
      }

      if (ctx.hasResponded() || ctx.isStopped()) return;
    }
  }

  // ─── Plugin Installation ──────────────────────────────────

  install(app: Runtime): void {
    // Capture `this` for use inside the step closure
    const HttpRouter = this;

    app.engine.add({
      name: "http-router",
      run: (ctx: Context) => {
        if (ctx.tcp || ctx.udp || ctx.grpc) return;
        const url = ctx.req.url;
        setPathnameIndices(url);
        const start = PATH_INDICES.start;
        const end = PATH_INDICES.end;
        const pathname = url.slice(start, end) || "/";
        const match = HttpRouter.resolve(ctx.req.method, url, start, end);

        if (!match) return;

        if (match.type === "method-not-allowed") {
          ctx.json({ error: "Method Not Allowed" }, 405);
          return;
        }

        const handleRouteError = (error: unknown) =>
          app.errorHandler.handle(error, ctx);

        ctx.params = match.params;
        const result = HTTPRouter.runChain(
          ctx,
          match.handlers,
          handleRouteError,
        );

        if (result instanceof Promise) {
          return (async () => {
            await result;
            if (ctx.hasResponded() || ctx.isStopped()) return;
            if (match.source === "specific") {
              const allMatch = HttpRouter.resolveAll(pathname);
              if (allMatch) {
                ctx.params = allMatch.params;
                await HTTPRouter.runChain(
                  ctx,
                  allMatch.handlers,
                  handleRouteError,
                );
              }
            }
          })();
        }

        if (ctx.hasResponded() || ctx.isStopped()) return;

        if (match.source === "specific") {
          const allMatch = HttpRouter.resolveAll(pathname);
          if (!allMatch) return;

          ctx.params = allMatch.params;
          return HTTPRouter.runChain(ctx, allMatch.handlers, handleRouteError);
        }
      },
    });
  }
}
