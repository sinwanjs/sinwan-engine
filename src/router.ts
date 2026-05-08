/**
 * SinwanJS Core Runtime — Router Plugin
 *
 * Radix-tree router with static fastpath, ALL bucket fallback,
 * and manual URL parsing for lower overhead.
 */

import type { Context } from "./context";
import type { Plugin } from "./types";
import type { Runtime } from "./runtime";

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

interface RouteRecord {
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
  handlers: Partial<Record<HttpMethod, RouteHandler[][]>>;
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

function addHandlers(
  node: RadixNode,
  method: HttpMethod,
  handlers: RouteHandler[],
): void {
  const bucket = node.handlers[method];
  if (bucket) {
    bucket.push(handlers);
  } else {
    node.handlers[method] = [handlers];
  }
}

function getHandlers(
  node: RadixNode,
  method: HttpMethod,
): RouteHandler[][] | null {
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

// Manual URL parser: only extract pathname and normalize trailing slash.
function parsePathname(url: string): string {
  let start = 0;
  const protoIdx = url.indexOf("://");
  if (protoIdx !== -1) {
    start = url.indexOf("/", protoIdx + 3);
    if (start === -1) return "/";
  }

  let end = url.length;
  for (let i = start; i < url.length; i += 1) {
    const cc = url.charCodeAt(i);
    if (cc === 63 || cc === 35) {
      end = i;
      break;
    }
  }

  let pathname = url.slice(start, end) || "/";
  if (pathname.length > 1 && pathname.charCodeAt(pathname.length - 1) === 47) {
    pathname = pathname.slice(0, -1);
  }

  return pathname;
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
): RouteHandler[][] | null {
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

export class Router implements Plugin {
  public readonly name = "sinwan:router";

  // Used by group() and debug tooling; private but preserved for compatibility.
  private readonly routes: RouteRecord[] = [];

  // Router-level middleware applied to all routes added AFTER this is called
  private readonly middlewares: RouteHandler[] = [];

  private readonly staticRoutes: Record<
    SpecificMethod,
    Map<string, RouteHandler[][]>
  > = {
    GET: new Map(),
    POST: new Map(),
    PUT: new Map(),
    PATCH: new Map(),
    DELETE: new Map(),
    OPTIONS: new Map(),
    HEAD: new Map(),
  };

  private readonly staticAll: Map<string, RouteHandler[][]> = new Map();

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

  /** Add router-level middleware. */
  use(...handlers: RouteHandler[]) {
    this.middlewares.push(...handlers);
  }

  /** Mount a group of routes under a prefix. */
  group(prefix: string, callback: (router: Router) => void) {
    const childRouter = new Router();
    callback(childRouter);

    const cleanPrefix = prefix === "/" ? "" : prefix.replace(/\/$/, "");
    const childRoutes = childRouter.routes;
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
   * @param prefix The URL prefix (e.g. "/public")
   * @param root   The local directory path (e.g. "./public")
   */
  static(prefix: string, root: string) {
    const cleanPrefix = prefix === "/" ? "" : prefix.replace(/\/$/, "");
    const cleanRoot = root.replace(/\/$/, "");

    this.get(cleanPrefix + "/*", async (ctx) => {
      const subPath = ctx.params["_wildcard"] || "";

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
    this.add("ALL", path, handlers);
  }

  private add(method: HttpMethod, path: string, routeHandlers: RouteHandler[]) {
    const normalized = normalizePath(path);
    const handlers = [...this.middlewares, ...routeHandlers];

    this.routes.push({ method, path: normalized, handlers });

    const hasParamsOrWildcard =
      normalized.includes(":") || normalized.includes("*");

    if (method === "ALL") {
      if (!hasParamsOrWildcard) {
        const bucket = this.staticAll.get(normalized);
        if (bucket) bucket.push(handlers);
        else this.staticAll.set(normalized, [handlers]);
      } else {
        const segments = splitPath(normalized);
        radixInsert(this.radixAll, segments, 0, "ALL", handlers);
      }
      return;
    }

    if (!hasParamsOrWildcard) {
      const bucket = this.staticRoutes[method].get(normalized);
      if (bucket) bucket.push(handlers);
      else this.staticRoutes[method].set(normalized, [handlers]);
      return;
    }

    const segments = splitPath(normalized);
    radixInsert(this.radix[method], segments, 0, method, handlers);
  }

  // ─── Resolution ───────────────────────────────────────────

  private resolve(
    method: string,
    pathname: string,
  ):
    | {
        type: "match";
        source: "specific" | "all";
        handlers: RouteHandler[][];
        params: Record<string, string>;
      }
    | { type: "method-not-allowed" }
    | null {
    const m = isSpecificMethod(method) ? method : undefined;
    let segCount = -1;
    const segs = SEG_BUFFER;
    const ensureSegments = () => {
      if (segCount === -1) segCount = segmentPath(pathname);
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
          params: {},
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
          params: { ...params },
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
            params: {},
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
            params: { ...params },
          };
        }
      }
    }

    // 3) ALL bucket fallback
    const allStatic = this.staticAll.get(pathname);
    if (allStatic) {
      return { type: "match", source: "all", handlers: allStatic, params: {} };
    }

    const params: Record<string, string> = Object.create(null);
    const count = ensureSegments();
    const allBucket = radixSearch(this.radixAll, segs, count, 0, "ALL", params);
    if (allBucket) {
      return {
        type: "match",
        source: "all",
        handlers: allBucket,
        params: { ...params },
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
  ): { handlers: RouteHandler[][]; params: Record<string, string> } | null {
    const allStatic = this.staticAll.get(pathname);
    if (allStatic) {
      return { handlers: allStatic, params: {} };
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
      return { handlers: allBucket, params: { ...params } };
    }

    return null;
  }

  // ─── Plugin Installation ──────────────────────────────────

  install(app: Runtime): void {
    app.engine.add({
      name: "router",
      run: async (ctx: Context) => {
        const pathname = parsePathname(ctx.req.url);
        const match = this.resolve(ctx.req.method, pathname);

        if (!match) return;

        if (match.type === "method-not-allowed") {
          ctx.json({ error: "Method Not Allowed" }, 405);
          return;
        }

        const runChains = async (chains: RouteHandler[][]) => {
          for (
            let chainIndex = 0;
            chainIndex < chains.length;
            chainIndex += 1
          ) {
            const chain = chains[chainIndex];
            if (!chain) continue;

            for (
              let handlerIndex = 0;
              handlerIndex < chain.length;
              handlerIndex += 1
            ) {
              const handler = chain[handlerIndex];
              if (!handler) continue;
              await handler(ctx);

              if (ctx.hasResponded() || ctx.isStopped()) return;
            }

            if (ctx.hasResponded() || ctx.isStopped()) return;
          }
        };

        ctx.params = match.params;
        await runChains(match.handlers);
        if (ctx.hasResponded() || ctx.isStopped()) return;

        if (match.source === "specific") {
          const allMatch = this.resolveAll(pathname);
          if (!allMatch) return;

          ctx.params = allMatch.params;
          await runChains(allMatch.handlers);
        }
      },
    });
  }
}
