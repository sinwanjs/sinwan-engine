/**
 * SinwanJS Core Runtime — CORS Middleware
 *
 * A professional, `cors`-package-style Cross-Origin Resource Sharing
 * middleware adapted to Sinwan's `ctx`-only handler model.
 *
 * Sinwan handlers receive only `ctx` (the engine advances the chain itself),
 * so this middleware:
 *   - sets CORS headers via `ctx.setHeader`,
 *   - short-circuits preflight (OPTIONS) requests via `ctx.setRawResponse`,
 *   - and simply `return`s to let the chain continue for actual responses.
 *
 * The public API mirrors the popular express `cors` middleware so existing
 * muscle memory transfers directly:
 *
 * ```ts
 * import { Sinwan, cors } from "sinwan-engine";
 *
 * const app = await Sinwan.create();
 *
 * // 1. Default: reflect any origin
 * app.use(cors());
 *
 * // 2. Configured
 * app.use(cors({
 *   origin: ["https://app.example.com", "https://admin.example.com"],
 *   credentials: true,
 *   maxAge: 86400,
 * }));
 *
 * // 3. Dynamic per-request options
 * app.use(cors((ctx, cb) => {
 *   cb(null, { origin: ctx.req.headers.get("host")?.endsWith(".test") });
 * }));
 *
 * // 4. Dynamic origin delegate
 * app.use(cors({
 *   origin: (origin, cb) => {
 *     if (!origin) return cb(null, false);
 *     cb(null, origin.endsWith(".example.com"));
 *   },
 * }));
 *
 * // 5. Explicit preflight handler (when you don't want app.use to cover OPTIONS)
 * app.options("*", cors.preflight({ origin: "*", maxAge: 3600 }));
 * ```
 *
 * No external dependencies — `object-assign` and `vary` are inlined as
 * small typed helpers, keeping `sinwan-engine` dependency-free.
 */

import type { Context } from "../context/context";
import type { RouteHandler } from "../routers/http-router";

// ─── Types ────────────────────────────────────────────────────────

/**
 * Static origin specification:
 *  - `true` / `undefined` → allow any origin (`*`).
 *  - `false`              → disallow (no `Access-Control-Allow-Origin`).
 *  - `string`             → fixed origin (or `"*"`).
 *  - `string[]`           → allow-list of exact origins.
 *  - `RegExp`             → allow origins matching the pattern.
 */
export type StaticOrigin = boolean | string | string[] | RegExp;

/**
 * Async delegate that resolves the allowed origin for a given request origin.
 *
 * Mirrors the express `cors` signature: call `cb(err, origin)` where `origin`
 * is a `StaticOrigin` (typically a `string` to reflect, `false` to disallow,
 * or `true`/`"*"` to allow any).
 */
export type OriginDelegate = (
  origin: string | null,
  cb: (err: Error | null, origin?: StaticOrigin) => void,
) => void;

/** Origin option: either a static spec or an async delegate. */
export type OriginOption = StaticOrigin | OriginDelegate;

/** CORS configuration options (subset of the express `cors` package). */
export interface CorsOptions {
  /**
   * Origin policy. Defaults to `"*"` (any origin).
   * Accepts a static spec or an async {@link OriginDelegate}.
   */
  origin?: OriginOption;
  /** Allowed HTTP methods. Defaults to `GET,HEAD,PUT,PATCH,POST,DELETE,QUERY`. */
  methods?: string | string[];
  /**
   * Allowed request headers. When omitted, the preflight response reflects
   * the request's `Access-Control-Request-Headers` value.
   */
  allowedHeaders?: string | string[];
  /** Alias for {@link allowedHeaders} (express compatibility). */
  headers?: string | string[];
  /** Response headers exposed to the client. */
  exposedHeaders?: string | string[];
  /** Whether to send `Access-Control-Allow-Credentials: true`. */
  credentials?: boolean;
  /** Preflight cache lifetime in seconds (`Access-Control-Max-Age`). */
  maxAge?: number | string;
  /**
   * If `true`, do not short-circuit the OPTIONS preflight — pass it down the
   * chain so a downstream handler can respond. Defaults to `false`.
   */
  preflightContinue?: boolean;
  /** Status code used for short-circuited preflight responses. Defaults to 204. */
  optionsSuccessStatus?: number;
}

/**
 * Per-request options delegate. Resolve `cb(null, options)` to override the
 * static configuration for a single request, or `cb(err)` to fail the chain.
 */
export type CorsOptionsDelegate = (
  ctx: Context,
  cb: (err: Error | null, options?: CorsOptions) => void,
) => void;

// ─── Defaults ─────────────────────────────────────────────────────

const DEFAULT_CORS_OPTIONS: Readonly<
  Required<
    Omit<
      CorsOptions,
      | "origin"
      | "allowedHeaders"
      | "headers"
      | "exposedHeaders"
      | "maxAge"
      | "credentials"
    >
  >
> = {
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,QUERY",
  preflightContinue: false,
  optionsSuccessStatus: 204,
};

// ─── Internal Header Record Type ──────────────────────────────────

interface HeaderRecord {
  key: string;
  value: string | false;
}

// `applyHeaders` accepts a nested array of records (mirroring the original
// `cors` package's structure, where configure* helpers may return either a
// single record, null, or an array of arrays of records).
type HeaderInput = HeaderRecord | HeaderRecord[] | HeaderInput[] | null;

// ─── Helpers ──────────────────────────────────────────────────────

function isString(s: unknown): s is string {
  return typeof s === "string" || s instanceof String;
}

function isOriginDelegate(value: unknown): value is OriginDelegate {
  return typeof value === "function";
}

/**
 * Test whether a request origin is allowed by a static origin spec.
 * Mirrors `isOriginAllowed` from the express `cors` package.
 */
function isOriginAllowed(origin: string, allowed: StaticOrigin): boolean {
  if (Array.isArray(allowed)) {
    for (let i = 0; i < allowed.length; i += 1) {
      if (isOriginAllowed(origin, allowed[i]!)) return true;
    }
    return false;
  }
  if (isString(allowed)) return origin === allowed;
  if (allowed instanceof RegExp) return allowed.test(origin);
  return !!allowed;
}

/** Join an array of header names into a comma-separated string. */
function joinHeaders(value: string | string[]): string {
  return Array.isArray(value) ? value.join(",") : value;
}

// ─── Configure Helpers ────────────────────────────────────────────

/**
 * Build the `Access-Control-Allow-Origin` (and `Vary`) header records.
 * Mirrors `configureOrigin` from the express `cors` package.
 */
function configureOrigin(
  options: ResolvedCorsOptions,
  ctx: Context,
): HeaderInput[] {
  const requestOrigin = ctx.req.headers.get("origin") ?? "";
  const records: HeaderInput[] = [];

  if (!options.origin || options.origin === "*") {
    records.push([{ key: "Access-Control-Allow-Origin", value: "*" }]);
  } else if (isString(options.origin)) {
    records.push([
      { key: "Access-Control-Allow-Origin", value: options.origin },
    ]);
    records.push([{ key: "Vary", value: "Origin" }]);
  } else {
    const isAllowed = isOriginAllowed(requestOrigin, options.origin);
    records.push([
      {
        key: "Access-Control-Allow-Origin",
        value: isAllowed ? requestOrigin : false,
      },
    ]);
    records.push([{ key: "Vary", value: "Origin" }]);
  }

  return records;
}

function configureMethods(options: ResolvedCorsOptions): HeaderRecord {
  return {
    key: "Access-Control-Allow-Methods",
    value: joinHeaders(options.methods),
  };
}

function configureCredentials(
  options: ResolvedCorsOptions,
): HeaderRecord | null {
  return options.credentials === true
    ? { key: "Access-Control-Allow-Credentials", value: "true" }
    : null;
}

/**
 * Build the `Access-Control-Allow-Headers` (and `Vary`) records.
 * When no allowed headers are configured, the request's
 * `Access-Control-Request-Headers` value is reflected (and `Vary` is set).
 */
function configureAllowedHeaders(
  options: ResolvedCorsOptions,
  ctx: Context,
): HeaderInput[] {
  const records: HeaderInput[] = [];
  let allowedHeaders = options.allowedHeaders ?? options.headers;

  if (!allowedHeaders) {
    allowedHeaders =
      ctx.req.headers.get("access-control-request-headers") ?? "";
    if (allowedHeaders)
      records.push([{ key: "Vary", value: "Access-Control-Request-Headers" }]);
  } else {
    allowedHeaders = joinHeaders(allowedHeaders);
  }

  if (allowedHeaders && allowedHeaders.length > 0) {
    records.push([
      { key: "Access-Control-Allow-Headers", value: allowedHeaders },
    ]);
  }

  return records;
}

function configureExposedHeaders(
  options: ResolvedCorsOptions,
): HeaderRecord | null {
  const headers = options.exposedHeaders;
  if (!headers) return null;
  const joined = joinHeaders(headers);
  if (joined && joined.length > 0) {
    return { key: "Access-Control-Expose-Headers", value: joined };
  }
  return null;
}

function configureMaxAge(options: ResolvedCorsOptions): HeaderRecord | null {
  const maxAge =
    (typeof options.maxAge === "number" || options.maxAge) &&
    String(options.maxAge);
  if (maxAge && maxAge.length > 0) {
    return { key: "Access-Control-Max-Age", value: maxAge };
  }
  return null;
}

// ─── Vary + Apply ─────────────────────────────────────────────────

/**
 * Append a value to the `Vary` response header, de-duplicating
 * case-insensitively. Inlined replacement for the `vary` package.
 */
function appendVary(ctx: Context, value: string): void {
  if (!value) return;
  const existing = ctx.headers.get("Vary");
  if (existing === null) {
    ctx.setHeader("Vary", value);
    return;
  }

  const parts = existing
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const lower = new Set(parts.map((p) => p.toLowerCase()));

  for (const piece of value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    if (!lower.has(piece.toLowerCase())) {
      parts.push(piece);
      lower.add(piece.toLowerCase());
    }
  }

  ctx.setHeader("Vary", parts.join(", "));
}

/**
 * Recursively apply a (possibly nested) header record structure to the
 * context. Mirrors `applyHeaders` from the express `cors` package:
 *  - `Vary` records are merged via {@link appendVary},
 *  - falsy `value`s are skipped (e.g. `Access-Control-Allow-Origin: false`
 *    when an origin is not allowed — the header is simply omitted).
 */
function applyHeaders(headers: HeaderInput, ctx: Context): void {
  if (headers === null) return;

  if (Array.isArray(headers)) {
    for (let i = 0; i < headers.length; i += 1) {
      applyHeaders(headers[i]!, ctx);
    }
    return;
  }

  if (headers.key === "Vary" && headers.value) {
    appendVary(ctx, headers.value);
  } else if (headers.value) {
    ctx.setHeader(headers.key, headers.value);
  }
}

// ─── Resolved Options ─────────────────────────────────────────────

/**
 * Options after merging user input with defaults, but before the dynamic
 * `origin` delegate has been resolved. `origin` may still be an
 * {@link OriginDelegate} here.
 */
interface MergedCorsOptions {
  origin: OriginOption;
  methods: string | string[];
  allowedHeaders?: string | string[];
  headers?: string | string[];
  exposedHeaders?: string | string[];
  credentials?: boolean;
  maxAge?: number | string;
  preflightContinue: boolean;
  optionsSuccessStatus: number;
}

/**
 * Fully resolved options: `origin` has been narrowed to a {@link StaticOrigin}.
 */
interface ResolvedCorsOptions extends MergedCorsOptions {
  origin: StaticOrigin;
}

function mergeDefaults(options: CorsOptions): MergedCorsOptions {
  return {
    origin: options.origin === undefined ? "*" : options.origin,
    methods: options.methods ?? DEFAULT_CORS_OPTIONS.methods,
    allowedHeaders: options.allowedHeaders,
    headers: options.headers,
    exposedHeaders: options.exposedHeaders,
    credentials: options.credentials,
    maxAge: options.maxAge,
    preflightContinue:
      options.preflightContinue ?? DEFAULT_CORS_OPTIONS.preflightContinue,
    optionsSuccessStatus:
      options.optionsSuccessStatus ?? DEFAULT_CORS_OPTIONS.optionsSuccessStatus,
  };
}

// ─── Core cors() ──────────────────────────────────────────────────

/**
 * Apply CORS headers and handle preflight for a single request.
 *
 * - OPTIONS (preflight): sets all CORS headers, then either short-circuits
 *   with `optionsSuccessStatus` (default) or returns to continue the chain
 *   when `preflightContinue` is `true`.
 * - Other methods: sets origin/credentials/exposed-headers, then returns so
 *   the route handler runs.
 */
function applyCors(options: ResolvedCorsOptions, ctx: Context): void {
  // origin: false → CORS disabled for this request (matches express behavior
  // where a falsy origin from the delegate skips all header setting).
  if (options.origin === false) return;

  const method = ctx.req.method.toUpperCase();
  const headers: HeaderInput[] = [];

  if (method === "OPTIONS") {
    // Preflight
    headers.push(configureOrigin(options, ctx));
    headers.push(configureCredentials(options));
    headers.push(configureMethods(options));
    headers.push(configureAllowedHeaders(options, ctx));
    headers.push(configureMaxAge(options));
    headers.push(configureExposedHeaders(options));
    applyHeaders(headers, ctx);

    if (options.preflightContinue) {
      // Let the chain continue to the next handler.
      return;
    }
    // Short-circuit: no body, configured status. `setRawResponse` marks the
    // context as responded and stops the chain (same primitive used by
    // InternalAssets). Some clients require Content-Length: 0 on 204.
    ctx.setRawResponse(null, options.optionsSuccessStatus);
    ctx.setHeader("Content-Length", "0");
    return;
  }

  // Actual response
  headers.push(configureOrigin(options, ctx));
  headers.push(configureCredentials(options));
  headers.push(configureExposedHeaders(options));
  applyHeaders(headers, ctx);
  // Continue chain — route handler will produce the response.
}

// ─── Callback → Promise Bridges ───────────────────────────────────

function resolveOptionsDelegate(
  delegate: CorsOptionsDelegate,
  ctx: Context,
): Promise<CorsOptions> {
  return new Promise((resolve, reject) => {
    try {
      delegate(ctx, (err, options) => {
        if (err) reject(err);
        else resolve(options ?? {});
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function resolveOriginDelegate(
  delegate: OriginDelegate,
  origin: string | null,
): Promise<StaticOrigin> {
  return new Promise((resolve, reject) => {
    try {
      delegate(origin, (err, value) => {
        if (err) reject(err);
        else resolve(value ?? false);
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

// ─── Public Factory ───────────────────────────────────────────────

interface CorsFactory {
  /**
   * Create a CORS middleware `RouteHandler`.
   *
   * Accepts:
   *  - nothing → defaults (any origin),
   *  - a {@link CorsOptions} object → static configuration,
   *  - a {@link CorsOptionsDelegate} → per-request dynamic configuration.
   *
   * The returned handler is async-safe and integrates with Sinwan's
   * chain runner: it sets headers and either short-circuits preflight or
   * returns to let the route handler run.
   */
  (options?: CorsOptions | CorsOptionsDelegate): RouteHandler;

  /**
   * Build an explicit OPTIONS preflight handler that always short-circuits
   * with the configured `optionsSuccessStatus` (default 204).
   *
   * Useful when you register CORS via `app.use(cors())` for actual responses
   * but want a dedicated, always-terminating preflight route:
   *
   * ```ts
   * app.use(cors({ origin: "https://app.example.com", credentials: true }));
   * app.options("*", cors.preflight({ origin: "https://app.example.com", credentials: true, maxAge: 86400 }));
   * ```
   */
  preflight(options?: CorsOptions | CorsOptionsDelegate): RouteHandler;
}

/**
 * Normalize the `origin` option: if it's an {@link OriginDelegate}, resolve
 * it for the current request; otherwise return the static spec as-is.
 */
async function resolveOrigin(
  options: MergedCorsOptions,
  ctx: Context,
): Promise<ResolvedCorsOptions> {
  const { origin } = options;
  if (isOriginDelegate(origin)) {
    const requestOrigin = ctx.req.headers.get("origin");
    const resolved = await resolveOriginDelegate(origin, requestOrigin);
    return { ...options, origin: resolved };
  }
  // Not a delegate → origin is already a StaticOrigin; reconstruct so TS
  // narrows the type from OriginOption to StaticOrigin.
  return { ...options, origin };
}

function buildHandler(
  input: CorsOptions | CorsOptionsDelegate | undefined,
  forcePreflight: boolean,
): RouteHandler {
  const delegate: CorsOptionsDelegate | null =
    typeof input === "function" ? input : null;
  const staticOptions: CorsOptions =
    typeof input === "function" ? {} : (input ?? {});

  return async function corsMiddleware(ctx: Context): Promise<void> {
    // 1. Resolve the effective options (static or per-request delegate).
    const userOptions: CorsOptions = delegate
      ? await resolveOptionsDelegate(delegate, ctx)
      : staticOptions;

    // 2. Merge with defaults, then resolve a dynamic origin delegate to a
    //    static spec for this request.
    const resolved = await resolveOrigin(mergeDefaults(userOptions), ctx);

    // 4. Apply. For `cors.preflight()` we force the preflight branch by
    //    temporarily treating the request as OPTIONS when it actually is.
    if (forcePreflight) {
      // origin: false → CORS disabled; let the chain continue.
      if (resolved.origin === false) return;

      // Always short-circuit as a preflight response, regardless of method.
      const headers: HeaderInput[] = [];
      headers.push(configureOrigin(resolved, ctx));
      headers.push(configureCredentials(resolved));
      headers.push(configureMethods(resolved));
      headers.push(configureAllowedHeaders(resolved, ctx));
      headers.push(configureMaxAge(resolved));
      headers.push(configureExposedHeaders(resolved));
      applyHeaders(headers, ctx);
      ctx.setRawResponse(null, resolved.optionsSuccessStatus);
      ctx.setHeader("Content-Length", "0");
      return;
    }

    applyCors(resolved, ctx);
  };
}

/**
 * Sinwan CORS middleware factory.
 *
 * @see CorsFactory
 */
const corsFactory = function cors(
  options?: CorsOptions | CorsOptionsDelegate,
): RouteHandler {
  return buildHandler(options, false);
} as CorsFactory;

corsFactory.preflight = function preflight(
  options?: CorsOptions | CorsOptionsDelegate,
): RouteHandler {
  return buildHandler(options, true);
};

export const cors = corsFactory;
