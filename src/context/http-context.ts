/**
 * SinwanJS Core Runtime — HTTP Context
 *
 * Per-request state container for HTTP executions. Holds the incoming
 * Request, outgoing response data, cookies, and body parsing.
 * Extends BaseContext with the HTTP-specific surface.
 *
 * Design:
 *  - Once a response is set (via json/text), the context is
 *    marked as "responded" and further mutations are rejected
 *    with a thrown error (loud failure > silent corruption).
 *  - stop() halts step execution but does NOT set a response.
 *  - Context can interact with the EventBus when attached.
 */

import { CookieMap, type Server } from "bun";
import { BaseContext, type ContextOptions } from "./base-context";
import type {
  SSEController,
  SSEOptions,
  Request,
  SaveFileOptions,
  ResponseKind,
} from "../types";
import { httpRespond, type HttpRespondApi } from "./helpers/http-respond";

/**
 * Custom HTTP error class for handling HTTP-specific errors.
 * Extends the native Error class with a statusCode property.
 */
class HttpError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export class HttpContext extends BaseContext {
  /** Protocol discriminator — routes this context to the HTTP pool. */
  public readonly protocol = "http" as const;

  /** The incoming Bun/Web API Request. */
  public req: Request;

  /** Cached pathname parsed from the request URL. */
  public pathname: string = "";

  /** HTTP status code for the response. */
  public statusCode: number = 200;

  /** Response body — set via json() or text(). */
  public body: unknown = null;

  /** Response headers. */
  private _headers?: Headers;
  get headers(): Headers {
    if (!this._headers) this._headers = new Headers();
    return this._headers;
  }

  /** Whether any response headers were explicitly set. */
  hasHeaders(): boolean {
    return this._headers !== undefined;
  }

  /**
   * Returns `Set-Cookie` header values for all changes made to
   * `ctx.cookies` (via `cookies.set`/`cookies.delete` or
   * `ctx.setCookie`/`ctx.deleteCookie`). Returns an empty array if
   * `ctx.cookies` was never accessed or no changes were made.
   * Used by the response builder to apply cookie mutations.
   * @internal
   */
  cookieHeaders(): string[] {
    return this._cookies ? this._cookies.toSetCookieHeaders() : [];
  }

  /**
   * Apply pending cookie mutations as `Set-Cookie` response headers and
   * emit the `cookie:set` event with the applied header values.
   *
   * Called by the response builder during finalization. No-op when no
   * cookie mutations were made.
   * @internal
   */
  applyCookieHeaders(): void {
    const cookieHeaders = this.cookieHeaders();
    if (cookieHeaders.length === 0) return;
    const h = this.headers; // lazy-inits _headers
    for (const value of cookieHeaders) {
      h.append("Set-Cookie", value);
    }
    if (this._bus && this._bus.hasListeners("cookie:set")) {
      this._bus.emitSync(
        "cookie:set",
        this,
        { headers: cookieHeaders },
        { source: "context", forceDelivery: true },
      );
    }
  }

  public params: Record<string, string> = {};

  /** Cached URLSearchParams parsed from the request URL. */
  private _query?: URLSearchParams;
  get query(): URLSearchParams {
    if (!this._query) {
      const url = this.req.url;
      const qIdx = url.indexOf("?");
      this._query =
        qIdx === -1
          ? new URLSearchParams()
          : new URLSearchParams(url.slice(qIdx + 1));
    }
    return this._query;
  }

  public maxBodySize: number = 10 * 1024 * 1024; // Default 10MB

  private _parsedBody: unknown = undefined;
  private _cookies?: CookieMap = undefined;
  private _formData?: Awaited<ReturnType<Request["formData"]>>;

  constructor(options: ContextOptions) {
    super(options);
    this.req = undefined as unknown as Request;
    this.httpRespond = httpRespond(this);

    // Copy the status-code helpers directly onto the instance so
    // `ctx.ok()` and `ctx.httpRespond.ok()` are equivalent (as documented
    // on the HttpRespondApi merge declaration below).
    for (const key of Object.keys(this.httpRespond)) {
      (this as unknown as Record<string, unknown>)[key] = (
        this.httpRespond as unknown as Record<string, unknown>
      )[key];
    }
  }

  /**
   * Reset the context for reuse in a pool.
   * Clears the HTTP-specific fields and delegates shared state to
   * `super.reset(options)`.
   */
  override reset(options: ContextOptions): void {
    super.reset(options);

    this.req = undefined as unknown as Request;
    this.pathname = "";
    this.statusCode = 200;
    this.body = null;
    this.params = {};
    this._query = undefined;
    this._parsedBody = undefined;
    this._cookies = undefined;
    this._formData = undefined;
    this.maxBodySize = 10 * 1024 * 1024;
    if (this._headers) this._headers = undefined;
  }

  /**
   * Delegate an error to the configured {@link ErrorHandler}.
   *
   * This is the canonical way to catch errors from async operations inside a
   * handler — the engine-driven chain runner does not expose a `next()` to
   * wrap in try/catch, so use this instead:
   *
   * ```ts
   * app.get("/risky", async (ctx) => {
   *   try {
   *     const data = await riskyOp();
   *     ctx.json(data);
   *   } catch (error) {
   *     await ctx.catch(error); // sets an error response on ctx
   *   }
   * });
   * ```
   *
   * @param error                  The thrown value.
   * @param _ctx                   Ignored — always `this`. Kept for backward
   *                               compatibility with the old 3-arg signature.
   * @param showMessageInProduction When `true`, the error message is included
   *                               in the response body even in production.
   * @returns A Promise that resolves once the error response is set.
   */
  catch(
    error: unknown,
    _ctx?: HttpContext,
    showMessageInProduction: boolean = false,
  ): Promise<void> {
    return this.errorHandler.handle(error, this, showMessageInProduction);
  }

  /**
   * Set the request (must be called before execute)
   */
  setReq(req: Request): void {
    this.req = req;
    const url = req.url;
    const start = url.indexOf("//") + 2;
    const pathStart = url.indexOf("/", start);

    let pathname: string;
    if (pathStart === -1) {
      pathname = "/";
    } else {
      // Find end of pathname: first '?' (63) or '#' (35) after pathStart
      let pathEnd = url.length;
      for (let i = pathStart; i < url.length; i++) {
        const cc = url.charCodeAt(i);
        if (cc === 63 || cc === 35) {
          pathEnd = i;
          break;
        }
      }
      pathname = url.slice(pathStart, pathEnd) || "/";
    }

    // Strip trailing slash (except for root "/") to match route normalization
    if (
      pathname.length > 1 &&
      pathname.charCodeAt(pathname.length - 1) === 47
    ) {
      pathname = pathname.slice(0, -1);
    }
    this.pathname = pathname;
  }

  // ─── Response Methods ───────────────────────────────────

  /**
   * Set a JSON response body.
   * Throws if a response has already been set.
   */
  json(data: unknown, status?: number): void {
    this.guardDoubleResponse();
    // Store raw object; buildResponse() will use Response.json() for native serialization
    this.commitResponse("json", data, status, "application/json");
  }

  /**
   * Set a plain-text response body.
   * Throws if a response has already been set.
   */
  text(data: string, status?: number): void {
    this.guardDoubleResponse();
    this.commitResponse("text", data, status, "text/plain");
  }

  /**
   * Set an HTML response body.
   * Throws if a response has already been set.
   */
  html(html: string | Promise<string>, status?: number): void | Promise<void> {
    if (html instanceof Promise) {
      return html.then((str) => {
        this.guardDoubleResponse();
        this.commitResponse("text", str, status, "text/html; charset=UTF-8");
      });
    }
    this.guardDoubleResponse();

    this.commitResponse("text", html, status, "text/html; charset=UTF-8");
  }

  /**
   * Redirect to a location.
   */
  redirect(path: string, status: number = 302): void {
    this.guardDoubleResponse();
    const url = new URL(path, this.req.url);
    this.headers.set("Location", url.toString());
    this.commitResponse("redirect", null, status);
  }

  /**
   * Redirect to a location with temporary data.
   * Data is stored in global state using a unique ephemeral key.
   */
  redirectWith<T>(
    path: string,
    data: T,
    options: {
      status?: 301 | 302 | 303 | 307 | 308;
      keyParam?: string;
    } = {},
  ): void {
    const { status = 302, keyParam = "redirect" } = options;

    this.guardDoubleResponse();

    // Generate unique temporary key
    const dataKey = `id_${crypto.randomUUID()}`;

    // Store redirect payload
    this.setGlobal(dataKey, data);

    // Build safe URL
    const url = new URL(path, this.req.url);
    url.searchParams.set(keyParam, dataKey);

    this.headers.set("Location", url.toString());

    this.commitResponse("redirect", null, status);
  }

  /**
   * Retrieve and consume redirect data.
   * The stored payload is removed immediately after access.
   */
  redirectData<V>(keyParam: string = "redirect"): V | undefined {
    const dataKey = this.query.get(keyParam);

    if (!dataKey) {
      return undefined;
    }

    // Prevent arbitrary global access
    if (!dataKey.startsWith("id_")) {
      return undefined;
    }

    return this.getGlobalOnce<V>(dataKey);
  }

  /**
   * Bundled HTTP status-code response helpers.
   *
   * Exposes concise methods such as {@link HttpRespondApi.ok},
   * {@link HttpRespondApi.notFound}, and {@link HttpRespondApi.continue}.
   * The helpers are also copied directly onto the `HttpContext` instance, so
   * `ctx.ok()` and `ctx.httpRespond.ok()` are equivalent.
   *
   * This is a response API, not flow control — calling any helper commits a
   * response and halts the current handler chain.
   */
  httpRespond!: HttpRespondApi;

  /**
   * Set a streaming response body.
   */
  stream(
    readable: ReadableStream,
    status?: number,
    contentType: string = "application/octet-stream",
  ): void {
    this.guardDoubleResponse();

    // Mark as streaming to prevent premature pool reuse
    this._status |= BaseContext.STREAMING;

    this.commitResponse(
      "stream",
      this.wrapStreamWithDisposal(readable),
      status,
      contentType,
    );
  }

  /**
   * Set a streaming response body using an async iterator or generator function.
   * Leveraging Bun's native support for streaming async iterables.
   * The iterator is wrapped to ensure context disposal on completion.
   */
  iterate(
    iterator:
      | AsyncIterable<Uint8Array | string>
      | (() => AsyncGenerator<Uint8Array | string>),
    status?: number,
    contentType: string = "text/plain",
  ): void {
    this.guardDoubleResponse();

    // Mark as streaming to prevent premature pool reuse
    this._status |= BaseContext.STREAMING;

    // Wrap iterator to ensure disposal on completion
    const wrappedIterator = this.wrapIteratorWithDisposal(iterator);
    this.commitResponse("iterator", wrappedIterator, status, contentType);
  }

  /** Start a Server-Sent Events response and return a controller for sending events. */
  sse(options: SSEOptions = {}): SSEController {
    this.guardDoubleResponse();

    // Mark as streaming to prevent premature pool reuse
    this._status |= BaseContext.STREAMING;

    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let closed = false;

    // The cancel arrow function correctly captures `this` (HttpContext instance)
    // from the enclosing scope — no change needed here.
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controller = ctrl;
      },
      cancel: (_reason) => {
        closed = true;
        this.dispose();
      },
    });

    const enqueue = (value: string) => {
      if (closed) return;
      controller.enqueue(encoder.encode(value));
    };

    const send = (
      data: string | object,
      event?: string,
      id?: string,
      retry?: number,
    ) => {
      if (closed) return;

      if (retry !== undefined) enqueue(`retry: ${retry}\n`);
      if (id !== undefined) enqueue(`id: ${id}\n`);
      if (event !== undefined) enqueue(`event: ${event}\n`);

      const payload = typeof data === "string" ? data : JSON.stringify(data);
      payload.split("\n").forEach((line) => enqueue(`data: ${line}\n`));
      enqueue("\n");
    };

    const comment = (text: string) => {
      if (closed) return;
      enqueue(`: ${text}\n\n`);
    };

    const close = () => {
      if (closed) return;
      closed = true;
      try {
        controller.close();
      } catch {
        // Ignore errors if already closed
      }
      this.dispose();
    };

    this.headers.set("Cache-Control", "no-cache");
    this.headers.set("Connection", "keep-alive");

    if (options.timeout !== undefined) {
      this.setTimeout(options.timeout);
    }

    this.commitResponse(
      "sse",
      stream,
      options.status ?? 200,
      "text/event-stream",
    );

    if (options.retry !== undefined) {
      enqueue(`retry: ${options.retry}\n`);
    }
    comment("ok");

    return { send, comment, close };
  }

  buffer(
    data: Uint8Array | ArrayBuffer,
    status?: number,
    contentType: string = "application/octet-stream",
  ): void {
    this.guardDoubleResponse();
    this.commitResponse("buffer", data, status, contentType);
  }

  /**
   * Set a file response body leveraging Bun.file() for zero-copy streaming.
   * Automatically infers Content-Type based on file extension.
   */
  file(path: string, status?: number, contentType?: string): void {
    this.guardDoubleResponse();
    const file = Bun.file(path);
    // Use provided contentType, or file's inferred type (which Bun provides),
    // or fallback to octet-stream if inference failed.
    const finalType =
      contentType ??
      (file.type !== "" ? file.type : "application/octet-stream");
    this.commitResponse("file", file, status, finalType);
  }

  /** Append or overwrite a single response header. */
  setHeader(key: string, value: string): void {
    this.headers.set(key, value);
    if (this._bus && this._bus.hasListeners("header:set")) {
      this._bus.emitSync(
        "header:set",
        this,
        { key, value },
        { source: "context" },
      );
    }
  }

  // ─── Bun Native Integrations ────────────────────────────

  /**
   * Access the request cookies as a Bun {@link CookieMap}.
   *
   * The map is lazily parsed from the `Cookie` header and cached for the
   * lifetime of the request. Bun's standard `Request` does not expose a
   * `cookies` property, so we construct the `CookieMap` ourselves.
   *
   * **Reading**: `ctx.cookies.get("session")`, `ctx.cookies.has("theme")`,
   * iteration via `for...of`, `toJSON()`, `size`.
   *
   * **Writing**: `ctx.cookies.set("name", "value", options)` and
   * `ctx.cookies.delete("name")` mutate the map; the response builder
   * collects those changes via `toSetCookieHeaders()` and applies them as
   * `Set-Cookie` headers automatically — matching Bun's `routes` API.
   */
  get cookies(): CookieMap {
    if (this._cookies) return this._cookies;
    const header = this.req.headers.get("Cookie");
    this._cookies = header ? new CookieMap(header) : new CookieMap();
    return this._cookies;
  }

  /**
   * Get the client IP and port from the Bun server.
   */
  get clientIP(): ReturnType<Server<unknown>["requestIP"]> | undefined {
    return this.server?.requestIP(this.req);
  }

  /**
   * Override the global idle timeout for this specific request.
   * Useful for long-lived streams like Server-Sent Events.
   * @param seconds Timeout in seconds, 0 to disable.
   */
  setTimeout(seconds: number): void {
    this.server?.timeout(this.req, seconds);
  }

  // ─── Private Internal Methods ───────────────────────────

  /**
   * Commits the response state. Sets body, status, headers, marks as responded,
   * and stops chain execution so the pipeline halts after the current handler.
   * Centralized to ensure consistent event emission and state management.
   *
   * Emits the `response:set` event (synchronously) with `{ kind, statusCode,
   * contentType }` when a listener is registered. This is the canonical
   * "after a handler responds" hook — register a context-scoped listener to
   * run code once a response has been committed:
   *
   * ```ts
   * app.get("/users", async (ctx) => {
   *   ctx.once("response:set", (c, { statusCode }) => {
   *     console.log("responded with", statusCode);
   *   });
   *   ctx.json(await listUsers());
   * });
   * ```
   *
   * For app-wide timing/logging, prefer `app.bus.on("request:end", ...)` which
   * fires once per request after the response is built.
   */
  private commitResponse(
    kind: ResponseKind,
    body: unknown,
    status?: number,
    contentType?: string,
  ): void {
    this.body = body;
    this.statusCode = status ?? this.statusCode;

    if (contentType) {
      this.headers.set("Content-Type", contentType);
    }

    this._status |= BaseContext.RESPONDED;
    this._status |= BaseContext.STOPPED;

    // Hot-path: only build payload and emit when someone is listening
    if (this._bus && this._bus.hasListeners("response:set")) {
      const finalContentType =
        contentType ?? this.headers.get("Content-Type") ?? "unknown";
      this._bus.emitSync(
        "response:set",
        this,
        {
          kind,
          statusCode: this.statusCode,
          contentType: finalContentType,
        },
        { source: "context", forceDelivery: true },
      );
    }

    this.emitStop();
  }

  // ─── Utilities ──────────────────────────────────────────

  /**
   * Safely read and parse the request body based on Content-Type.
   * Caches the result so it can be called multiple times.
   *
   * Security: Enforces maxBodySize limits to prevent OOM attacks.
   * For unknown content types, uses streaming-safe approach.
   *
   * For multipart/form-data and application/x-www-form-urlencoded the result
   * is a `Record<string, string | File>` — File entries are preserved as-is
   * so callers can inspect them or pass them to saveFile().
   */
  async parseBody<T = unknown>(): Promise<T> {
    if (this._parsedBody !== undefined) return this._parsedBody as T;

    const contentType = this.req.headers.get("content-type") || "";
    const contentLengthStr = this.req.headers.get("content-length");
    const contentLength = contentLengthStr
      ? parseInt(contentLengthStr, 10)
      : -1;

    if (contentLength > this.maxBodySize) {
      throw new HttpError(
        `Payload too large (limit: ${this.maxBodySize} bytes)`,
        413,
      );
    }

    let kind: "json" | "form" | "text" = "text";

    try {
      if (contentType.includes("application/json")) {
        kind = "json";
        // Use Bun's built-in size enforcement via arrayBuffer
        this._parsedBody = await this.safeJson();
      } else if (
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("multipart/form-data")
      ) {
        kind = "form";
        // Delegate to formData() so the cache is shared between both methods.
        const fd = await this.formData();
        const obj: Record<string, string | File> = {};
        for (const [k, v] of fd.entries()) {
          obj[k] = v as string | File;
        }
        this._parsedBody = obj;
      } else {
        kind = "text";
        // Safe text fallback with size limit
        this._parsedBody = await this.safeText();
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const error = new HttpError("Failed to parse request body", 400);
      this.emitSyncIfAvailable("body:parse:error", { error });
      throw error;
    }

    this.emitSyncIfAvailable("body:parsed", { kind });
    return this._parsedBody as T;
  }

  /**
   * Safe JSON parsing with size enforcement.
   * Uses Bun's native streaming JSON parser when available.
   */
  private async safeJson(): Promise<unknown> {
    // Bun's req.json() already handles streaming efficiently
    // We just need to enforce size limits for responses without content-length
    const contentLength = this.req.headers.get("content-length");
    if (!contentLength) {
      // No content-length header - read as text first to enforce limit
      const text = await this.safeText();
      return JSON.parse(text as string);
    }
    return this.req.json();
  }

  /**
   * Safe text reading with streaming size enforcement.
   * Prevents OOM by limiting total bytes read.
   */
  private async safeText(): Promise<string> {
    const contentLength = this.req.headers.get("content-length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (size > this.maxBodySize) {
        throw new HttpError(
          `Payload too large (limit: ${this.maxBodySize} bytes)`,
          413,
        );
      }
      return this.req.text();
    }

    // No content-length — stream with size enforcement to prevent OOM
    const reader = this.req.body?.getReader();
    if (!reader) return "";

    const decoder = new TextDecoder();
    let result = "";
    let totalSize = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalSize += value.byteLength;
      if (totalSize > this.maxBodySize) {
        reader.cancel().catch(() => {});
        throw new HttpError(
          `Payload too large (limit: ${this.maxBodySize} bytes)`,
          413,
        );
      }
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
    return result;
  }

  /**
   * Return the raw `FormData` from the request body, caching it so the
   * underlying stream is consumed only once.
   *
   * Security: Enforces maxBodySize limits to prevent OOM from large uploads.
   *
   * Throws an HttpError(415) if the Content-Type is not a form type, and
   * an HttpError(400) if the body cannot be parsed.
   * Throws an HttpError(413) if the body exceeds maxBodySize.
   *
   * Usage:
   * ```ts
   * const fd = await ctx.formData();
   * const name = fd.get("name") as string;
   * const avatar = fd.get("avatar") as File;
   * ```
   */
  async formData(): Promise<Awaited<ReturnType<Request["formData"]>>> {
    if (this._formData) return this._formData;

    const contentType = this.req.headers.get("content-type") || "";
    const contentLengthStr = this.req.headers.get("content-length");
    const contentLength = contentLengthStr
      ? parseInt(contentLengthStr, 10)
      : -1;

    if (contentLength > this.maxBodySize) {
      throw new HttpError(
        `Payload too large (limit: ${this.maxBodySize} bytes)`,
        413,
      );
    }

    if (contentLength === 0) {
      throw new HttpError("Request body is empty", 400);
    }

    const isForm =
      contentType.includes("multipart/form-data") ||
      contentType.includes("application/x-www-form-urlencoded");

    if (!isForm) {
      throw new HttpError(
        `Expected a form Content-Type, got: ${contentType || "(none)"}`,
        415,
      );
    }

    try {
      // Bun's formData() is streaming-safe for multipart
      // It handles large files without loading everything into memory
      this._formData = await this.req.formData();

      // Enforce size limit for responses without content-length
      // Check total size of all file entries
      if (contentLength === -1 && this._formData) {
        let totalSize = 0;
        for (const [_, value] of this._formData.entries()) {
          const entry = value as unknown;
          // Check if value is a File-like object (has size property)
          if (
            entry != null &&
            typeof entry === "object" &&
            "size" in entry &&
            typeof (entry as File).size === "number"
          ) {
            totalSize += (entry as File).size;
            if (totalSize > this.maxBodySize) {
              this._formData = undefined;
              throw new HttpError(
                `Payload too large (limit: ${this.maxBodySize} bytes)`,
                413,
              );
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;

      // Fallback: reconstruct from blob (for edge cases)
      try {
        const blob = await this.req.blob();
        if (blob.size > this.maxBodySize) {
          throw new HttpError(
            `Payload too large (limit: ${this.maxBodySize} bytes)`,
            413,
          );
        }
        const response = new Response(blob, {
          headers: { "Content-Type": contentType },
        });
        this._formData = await response.formData();
      } catch (fallbackErr) {
        if (fallbackErr instanceof HttpError) throw fallbackErr;
        const error = new HttpError(
          "Failed to parse multipart/form-data body",
          400,
        );
        this.emitSyncIfAvailable("body:parse:error", { error });
        throw error;
      }
    }

    this.emitSyncIfAvailable("body:parsed", { kind: "form" });
    return this._formData!;
  }

  /**
   * Extract a file field from the multipart form and write it to disk using
   * Bun.write() (zero-copy where possible).
   *
   * @param field   The FormData field name that contains the uploaded file.
   * @param dest    Destination path on disk.
   * @param options Validation options (size, type).
   * @returns       The number of bytes written.
   *
   * Throws:
   *   - HttpError(400) if the field is missing or is not a File.
   *   - HttpError(413) if the file exceeds maxSize.
   *   - HttpError(415) if the file type is not allowed.
   *
   * Usage:
   * ```ts
   * // In a route handler:
   * const bytes = await ctx.saveFile("avatar", "./uploads/me.png", {
   *   maxSize: 5 * 1024 * 1024, // 5MB
   *   allowedTypes: ['image/png', 'image/jpeg']
   * });
   * ```
   */
  async saveFile(
    field: string,
    dest: string,
    options: SaveFileOptions = {},
  ): Promise<number> {
    const fd = await this.formData();
    const entry = fd.get(field);

    if (!entry) {
      throw new HttpError(
        `Form field "${field}" is missing from the request.`,
        400,
      );
    }

    if (typeof entry === "string") {
      throw new HttpError(
        `Form field "${field}" is a plain string, expected a file upload.`,
        400,
      );
    }

    // Validation: File Size
    if (options.maxSize && entry.size > options.maxSize) {
      throw new HttpError(
        `File too large: ${entry.size} bytes (max: ${options.maxSize})`,
        413,
      );
    }

    // Validation: File Type (MIME)
    if (options.allowedTypes && !options.allowedTypes.includes(entry.type)) {
      throw new HttpError(
        `Invalid file type: ${entry.type}. Allowed: ${options.allowedTypes.join(", ")}`,
        415,
      );
    }

    // entry is a File (subtype of Blob). Bun.write() accepts Blob natively.
    const bytesWritten = await Bun.write(dest, entry);

    this.emitSyncIfAvailable("file:saved", {
      field,
      dest,
      size: bytesWritten,
      name: (entry as File).name,
      type: entry.type,
    });

    return bytesWritten;
  }

  /**
   * Save multiple file fields from the multipart form in one call.
   *
   * @param uploads  Array of `{ field, dest }` pairs.
   * @returns        A map of field name → bytes written.
   *
   * Usage:
   * ```ts
   * const results = await ctx.saveFiles([
   *   { field: "avatar",  dest: "./uploads/avatar.png"  },
   *   { field: "resume",  dest: "./uploads/resume.pdf"  },
   * ]);
   * ctx.json(Object.fromEntries(results));
   * ```
   */
  async saveFiles(
    uploads: Array<{ field: string; dest: string }>,
  ): Promise<Map<string, number>> {
    const results = new Map<string, number>();
    // Run all writes concurrently — each saveFile() call reuses the cached FormData.
    await Promise.all(
      uploads.map(async ({ field, dest }) => {
        const bytes = await this.saveFile(field, dest);
        results.set(field, bytes);
      }),
    );
    return results;
  }

  // ─── Flow Control ───────────────────────────────────────

  /**
   * Set a raw response without triggering response:set events.
   * Intended for internal handlers (e.g. InternalAssets) that need
   * to short-circuit the pipeline without the full commitResponse overhead.
   */
  setRawResponse(
    body: unknown,
    status: number = 200,
    contentType?: string,
  ): void {
    this.body = body;
    this.statusCode = status;
    if (contentType) {
      this.headers.set("Content-Type", contentType);
    }
    this._status |= BaseContext.RESPONDED;
    this.stop();
  }

  /**
   * Wrap an iterator with automatic disposal when iteration completes.
   * This ensures the context is properly cleaned up after streaming.
   */
  private wrapIteratorWithDisposal(
    iterator:
      | AsyncIterable<Uint8Array | string>
      | (() => AsyncGenerator<Uint8Array | string>),
  ): AsyncIterable<Uint8Array | string> {
    const self = this;

    // Handle generator function
    const source = typeof iterator === "function" ? iterator() : iterator;

    const asyncIterator = (): AsyncGenerator<
      Uint8Array | string,
      void,
      unknown
    > => {
      const originalIterator = source[Symbol.asyncIterator]();
      let done = false;

      function cleanup() {
        if (!done) {
          done = true;
          // Schedule disposal on next microtask to allow response to complete
          queueMicrotask(() => self.dispose());
        }
      }

      return {
        async next() {
          try {
            const result = await originalIterator.next();
            if (result.done) {
              cleanup();
            }
            return result;
          } catch (error) {
            cleanup();
            throw error;
          }
        },
        async return(value) {
          cleanup();
          if (originalIterator.return) {
            return originalIterator.return(value);
          }
          return { done: true, value } as IteratorResult<
            Uint8Array | string,
            void
          >;
        },
        async throw(error) {
          cleanup();
          if (originalIterator.throw) {
            return originalIterator.throw(error);
          }
          throw error;
        },
      } as AsyncGenerator<Uint8Array | string, void, unknown>;
    };

    return {
      [Symbol.asyncIterator]: asyncIterator,
    };
  }

  /**
   * Wrap a ReadableStream with automatic disposal when the stream closes
   * or is cancelled. Replaces the previous TransformStream passthrough.
   */
  private wrapStreamWithDisposal(stream: ReadableStream): ReadableStream {
    const self = this;
    const reader = stream.getReader();
    let closed = false;

    const pump = (controller: ReadableStreamDefaultController<Uint8Array>) => {
      reader.read().then(
        ({ done, value }) => {
          if (done) {
            if (!closed) {
              closed = true;
              controller.close();
              queueMicrotask(() => self.dispose());
            }
            return;
          }
          if (!closed) {
            controller.enqueue(value);
            if (
              controller.desiredSize !== null &&
              controller.desiredSize <= 0
            ) {
              return;
            }
            pump(controller);
          }
        },
        (err) => {
          if (!closed) {
            closed = true;
            controller.error(err);
            queueMicrotask(() => self.dispose());
          }
        },
      );
    };

    return new ReadableStream({
      start(controller) {
        pump(controller);
      },
      pull(controller) {
        pump(controller);
      },
      cancel() {
        closed = true;
        reader.cancel().catch(() => {});
        queueMicrotask(() => self.dispose());
      },
    });
  }
}

/**
 * Merge the {@link HttpRespondApi} helpers into the public `HttpContext` type.
 * The methods are copied onto each instance at construction time so they can be
 * called directly, e.g. `ctx.ok()` or `ctx.notFound("Todo not found")`.
 */
export interface HttpContext extends HttpRespondApi {}
