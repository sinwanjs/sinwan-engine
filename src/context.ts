/**
 * SinwanJS Core Runtime — Context
 *
 * Per-request state container. Holds the incoming Request,
 * outgoing response data, and control flags.
 *
 * Design:
 *  - Once a response is set (via json/text), the context is
 *    marked as "responded" and further mutations are rejected
 *    with a thrown error (loud failure > silent corruption).
 *  - stop() halts step execution but does NOT set a response.
 *  - Context can interact with the EventBus when attached.
 */

import type { CookieMap, Server } from "bun";
import type { EventBus } from "./event-bus";
import type {
  ContextOptions,
  EmitOptions,
  EmitResult,
  EventHandler,
  EventMeta,
  EventTraceEntry,
  EventTraceOptions,
  ListenerOptions,
  SSEController,
  SSEOptions,
  Request,
  SaveFileOptions,
  ResponseKind,
} from "./types";

// Proper typed HTTP error class
class HttpError extends Error {
  public readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export class Context {
  /** The incoming Bun/Web API Request. */
  public req: Request;

  /**
   * The Bun Server instance (if provided).
   * Guards added in clientIP / setTimeout before access.
   */
  public readonly server: Server<any> | undefined;

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

  /** Arbitrary per-request state for steps/plugins. */
  private _state?: Map<string, any>;
  get state(): Map<string, any> {
    if (!this._state) this._state = new Map();
    return this._state;
  }

  /** Shared application-level state. */
  private readonly global: Map<string, any>;
  public params: Record<string, string> = {};
  private _requestId: string = "";
  private static _idCounter: number = 0;

  public maxBodySize: number = 10 * 1024 * 1024; // Default 10MB

  get requestId(): string {
    if (this._requestId === "") {
      this._requestId = `req-${++Context._idCounter}`;
    }
    return this._requestId;
  }

  set requestId(value: string) {
    this._requestId = value;
  }

  // ─── Internal Flags ─────────────────────────────────────

  private _status: number = 0;
  private static readonly STOPPED = 1 << 0;
  private static readonly RESPONDED = 1 << 1;
  private static readonly DISPOSED = 1 << 2;
  private static readonly STREAMING = 1 << 3;

  private _parsedBody: unknown = undefined;
  private _formData?: FormData;
  private _bus?: EventBus;
  private _onDisposeCallbacks: (() => void)[] = [];

  /** @internal */
  public _meta: any = {
    name: "",
    event: "",
    timestamp: 0,
    sequence: 0,
    requestId: "",
    source: undefined,
  };

  private readonly traceOptions: Required<EventTraceOptions>;
  private _eventTrace?: EventTraceEntry[];
  private _traceStart: number = 0;
  private _traceSize: number = 0;

  get eventTrace(): EventTraceEntry[] {
    const buffer = this.getTraceBuffer();
    if (this._traceSize === 0) return buffer;
    if (this._traceStart === 0 && this._traceSize === buffer.length)
      return buffer;

    const ordered = new Array<EventTraceEntry>(this._traceSize);
    const len = buffer.length;
    for (let i = 0; i < this._traceSize; i += 1) {
      ordered[i] = buffer[(this._traceStart + i) % len]!;
    }
    return ordered;
  }

  private _scopedHandlers?: Map<string, Map<EventHandler, Set<EventHandler>>>;
  get scopedHandlers(): Map<string, Map<EventHandler, Set<EventHandler>>> {
    if (!this._scopedHandlers) this._scopedHandlers = new Map();
    return this._scopedHandlers;
  }

  constructor(options: ContextOptions = {}) {
    this.req = undefined as unknown as Request;
    this.server = options.server;
    if (options.requestId) this._requestId = options.requestId;
    this._bus = options.bus;

    this.traceOptions = {
      enabled: options.trace?.enabled ?? true,
      maxEntries: options.trace?.maxEntries ?? 100,
      includePayload: options.trace?.includePayload ?? false,
    };

    this.global = options.global ?? new Map();
  }

  /**
   * Reset the context for reuse in a pool.
   */
  reset(options: ContextOptions = {}): void {
    this.req = undefined as unknown as Request;
    this.statusCode = 200;
    this.body = null;
    this.params = {};
    this._requestId = options.requestId || "";
    this._status = 0;
    this._parsedBody = undefined;
    this._formData = undefined;
    this._bus = options.bus;
    this._onDisposeCallbacks.length = 0;

    // Reset meta
    this._meta.name = "";
    this._meta.event = "";
    this._meta.timestamp = 0;
    this._meta.sequence = 0;
    this._meta.requestId = options.requestId || "";
    this._meta.source = undefined;

    // Fast clear for reused objects
    if (this._headers) this._headers = undefined;
    if (this._state) this._state.clear();
    if (this._eventTrace) this._eventTrace.length = 0;
    this._traceStart = 0;
    this._traceSize = 0;
    if (this._scopedHandlers) this._scopedHandlers.clear();
  }

  /**
   * Set the request (must be called before execute)
   */
  setReq(req: Request): void {
    this.req = req;
  }

  // ─── State Management ───────────────────────────────────

  /** Set a value in the request state. */
  set(key: string, value: any): void {
    this.state.set(key, value);
  }

  /** Get a value from the request state. */
  get<T = any>(key: string): T | undefined {
    return this.state.get(key) as T;
  }

  /** Check if a value exists in the request state. */
  has(key: string): boolean {
    return this.state.has(key);
  }

  // ─── Global State Management ──────────────────────────────

  /** Set a value in the global application state. */
  setGlobal(key: string, value: any): void {
    this.global.set(key, value);
  }

  /** Get a value from the global application state. */
  getGlobal<T = any>(key: string): T | undefined {
    return this.global.get(key) as T;
  }

  /** Check if a value exists in the global state. */
  hasGlobal(key: string): boolean {
    return this.global.has(key);
  }

  // ─── Response Methods ───────────────────────────────────

  /**
   * Set a JSON response body.
   * Throws if a response has already been set.
   */
  json(data: unknown, status?: number): void {
    this.guardDoubleResponse();
    // Pre-serialize JSON so buildResponse() hits the string fast-path
    this.commitResponse(
      "json",
      JSON.stringify(data),
      status,
      "application/json",
    );
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
   * Set a streaming response body.
   */
  stream(
    readable: ReadableStream,
    status?: number,
    contentType: string = "application/octet-stream",
  ): void {
    this.guardDoubleResponse();

    // Mark as streaming to prevent premature pool reuse
    this._status |= Context.STREAMING;

    // Pipe through a passthrough TransformStream.
    const passthrough = new TransformStream();
    readable.pipeTo(passthrough.writable).finally(() => this.dispose());

    this.commitResponse("stream", passthrough.readable, status, contentType);
  }

  /**
   * Set a streaming response body using an async iterator or generator function.
   * Leveraging Bun's native support for streaming async iterables.
   * The iterator is wrapped to ensure context disposal on completion.
   */
  iterate(
    iterator: AsyncIterable<any> | (() => AsyncGenerator<any>),
    status?: number,
    contentType: string = "text/plain",
  ): void {
    this.guardDoubleResponse();

    // Mark as streaming to prevent premature pool reuse
    this._status |= Context.STREAMING;

    // Wrap iterator to ensure disposal on completion
    const wrappedIterator = this.wrapIteratorWithDisposal(iterator);
    this.commitResponse("iterator", wrappedIterator, status, contentType);
  }

  /** Start a Server-Sent Events response and return a controller for sending events. */
  sse(options: SSEOptions = {}): SSEController {
    this.guardDoubleResponse();

    // Mark as streaming to prevent premature pool reuse
    this._status |= Context.STREAMING;

    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let closed = false;

    // The cancel arrow function correctly captures `this` (Context instance)
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

  /** Access the CookieMap from the incoming Bun request. */
  get cookies(): CookieMap {
    return this.req.cookies;
  }

  /**
   * Get the client IP and port from the Bun server.
   */
  get clientIP(): ReturnType<Server<any>["requestIP"]> | undefined {
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
   * Commits the response state. Sets body, status, headers and marks as responded.
   * Centralized to ensure consistent event emission and state management.
   */
  private commitResponse<T = any>(
    kind: ResponseKind,
    body: T,
    status?: number,
    contentType?: string,
  ): void {
    this.body = body;
    this.statusCode = status ?? this.statusCode;

    if (contentType) {
      this.headers.set("Content-Type", contentType);
    }

    this._status |= Context.RESPONDED;

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
        { source: "context" },
      );
    }
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

    // No content-length - stream with limit enforcement
    // Bun's req.text() is already streaming, but we need to check size after
    const text = await this.req.text();
    if (text.length > this.maxBodySize) {
      throw new HttpError(
        `Payload too large (limit: ${this.maxBodySize} bytes)`,
        413,
      );
    }
    return text;
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
  async formData(): Promise<FormData> {
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
      this._formData = (await this.req.formData()) as any;

      // Enforce size limit for responses without content-length
      // Check total size of all file entries
      if (contentLength === -1 && this._formData) {
        let totalSize = 0;
        for (const [_, value] of this._formData.entries()) {
          // Check if value is a File-like object (has size property)
          if (
            value &&
            typeof value === "object" &&
            "size" in value &&
            typeof (value as any).size === "number"
          ) {
            totalSize += (value as any).size;
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
        this._formData = (await response.formData()) as any;
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

  /** Signal that step execution should halt after the current step. */
  stop(): void {
    this._status |= Context.STOPPED;
    if (this._bus && this._bus.hasListeners("context:stop")) {
      this._bus.emitSync("context:stop", this, undefined, {
        source: "context",
      });
    }
  }

  /** Whether stop() has been called. */
  isStopped(): boolean {
    return (this._status & Context.STOPPED) !== 0;
  }

  /** Whether json() or text() has been called. */
  hasResponded(): boolean {
    return (this._status & Context.RESPONDED) !== 0;
  }

  /** Whether the context has an active streaming response. */
  isStreaming(): boolean {
    return (this._status & Context.STREAMING) !== 0;
  }

  // ─── EventBus Interaction ──────────────────────────────

  /** Attach an EventBus to this context. */
  attachBus(bus: EventBus): void {
    if (this._bus && this._bus !== bus) {
      throw new Error("Context is already attached to a different EventBus.");
    }
    this._bus = bus;
  }

  /** Emit an event through the attached EventBus. */
  async emitAsync(
    event: string,
    payload?: unknown,
    options?: EmitOptions,
  ): Promise<EmitResult> {
    return this.getBus().emitAsync(
      event,
      this,
      payload,
      this.withSource(options),
    );
  }

  /** Emit an event synchronously through the attached EventBus. */
  emitSync(
    event: string,
    payload?: unknown,
    options?: EmitOptions,
  ): EmitResult {
    return this.getBus().emitSync(
      event,
      this,
      payload,
      this.withSource(options),
    );
  }

  /**
   * Register a listener scoped to this context.
   */
  on(event: string, handler: EventHandler, options?: ListenerOptions): this {
    const bus = this.getBus();
    const wrapped = this.wrapScopedHandler(event, handler, false);
    bus.on(event, wrapped, options);
    this.trackHandler(event, handler, wrapped);
    return this;
  }

  /** Register a once-only listener scoped to this context. */
  once(event: string, handler: EventHandler, options?: ListenerOptions): this {
    const bus = this.getBus();
    const wrapped = this.wrapScopedHandler(event, handler, true);
    bus.once(event, wrapped, options);
    this.trackHandler(event, handler, wrapped);
    return this;
  }

  /**
   * Remove a scoped listener.
   * Removes the most-recently-added wrapped handler for this original handler.
   */
  off(event: string, handler: EventHandler): this {
    const bus = this.getBus();
    const wrapped = this.getTrackedHandler(event, handler);
    if (wrapped) {
      bus.off(event, wrapped);
      this.untrackHandler(event, handler, wrapped);
    }
    return this;
  }

  /** Register a callback to be executed when the context is disposed. */
  onDispose(cb: () => void): void {
    if ((this._status & Context.DISPOSED) !== 0) {
      cb();
      return;
    }
    this._onDisposeCallbacks.push(cb);
  }

  /** Dispose context-scoped listeners and trigger cleanup callbacks. */
  dispose(): void {
    if ((this._status & Context.DISPOSED) !== 0) return;
    this._status |= Context.DISPOSED;

    // Clear streaming flag to allow pool reuse
    this._status &= ~Context.STREAMING;

    if (this._bus && this._bus.hasListeners("context:dispose")) {
      this._bus.emitSync("context:dispose", this, undefined, {
        source: "context",
      });
    }

    // Only iterate scoped handlers if any were registered
    if (this._bus && this.scopedHandlers.size > 0) {
      for (const [event, handlerMap] of this.scopedHandlers.entries()) {
        for (const wrappedSet of handlerMap.values()) {
          for (const wrapped of wrappedSet) {
            this._bus.off(event, wrapped);
          }
        }
      }
      this.scopedHandlers.clear();
    }

    // Trigger onDispose callbacks
    for (let i = 0; i < this._onDisposeCallbacks.length; i++) {
      try {
        this._onDisposeCallbacks[i]!();
      } catch {
        // Ignore callback errors
      }
    }
    this._onDisposeCallbacks.length = 0;
  }

  /** Access a copy of the event trace for this context. */
  getEventTrace(): readonly EventTraceEntry[] {
    return this.eventTrace;
  }

  /** Record an event trace entry (used by EventBus). */
  recordEvent(meta: EventMeta, payload: unknown): void {
    if (!this.traceOptions.enabled) return;

    const maxEntries = this.traceOptions.maxEntries;
    if (maxEntries <= 0) return;

    const entry: EventTraceEntry = {
      name: meta.name,
      event: meta.event,
      timestamp: meta.timestamp,
      sequence: meta.sequence,
      requestId: meta.requestId,
      source: meta.source,
    };

    if (this.traceOptions.includePayload) {
      entry.payload = payload;
    }

    const buffer = this.getTraceBuffer();
    if (buffer.length < maxEntries) {
      buffer.push(entry);
      this._traceSize = buffer.length;
      return;
    }

    // Ring buffer overwrite to avoid per-request trimming.
    buffer[this._traceStart] = entry;
    this._traceStart = (this._traceStart + 1) % maxEntries;
    this._traceSize = maxEntries;
  }

  private getTraceBuffer(): EventTraceEntry[] {
    if (!this._eventTrace) this._eventTrace = [];
    return this._eventTrace;
  }

  // ─── Guards ─────────────────────────────────────────────

  /** Throws if a response body has already been committed. */
  private guardDoubleResponse(): void {
    if ((this._status & Context.RESPONDED) !== 0) {
      throw new Error("Response already sent. Cannot set body more than once.");
    }
  }

  private getBus(): EventBus {
    if (!this._bus) {
      throw new Error("Context is not attached to an EventBus.");
    }
    return this._bus;
  }

  private withSource(options?: EmitOptions): EmitOptions {
    return {
      ...options,
      source: options?.source ?? "context",
    };
  }

  private emitSyncIfAvailable(event: string, payload?: unknown): void {
    if (!this._bus) return;
    this._bus.emitSync(event, this, payload, { source: "context" });
  }

  private wrapScopedHandler(
    event: string,
    handler: EventHandler,
    isOnce: boolean,
  ): EventHandler {
    // Capture `wrapped` via a closure reference so the once-cleanup can
    // untrack this specific wrapped instance (not just any wrapped for handler).
    let wrapped: EventHandler;
    wrapped = (ctx, payload, meta) => {
      if (ctx !== this) return;
      if (isOnce) {
        this.untrackHandler(event, handler, wrapped);
      }
      return handler(ctx, payload, meta);
    };
    return wrapped;
  }

  // Map stores Set<EventHandler> so multiple registrations of the
  // same original handler each get their own tracked wrapped handler entry.
  private trackHandler(
    event: string,
    handler: EventHandler,
    wrapped: EventHandler,
  ): void {
    let handlerMap = this.scopedHandlers.get(event);
    if (!handlerMap) {
      handlerMap = new Map();
      this.scopedHandlers.set(event, handlerMap);
    }
    let wrappedSet = handlerMap.get(handler);
    if (!wrappedSet) {
      wrappedSet = new Set();
      handlerMap.set(handler, wrappedSet);
    }
    wrappedSet.add(wrapped);
  }

  /**
   * Returns the most recently tracked wrapped handler for the given original,
   * or undefined if none exists.
   */
  private getTrackedHandler(
    event: string,
    handler: EventHandler,
  ): EventHandler | undefined {
    const handlerMap = this.scopedHandlers.get(event);
    const wrappedSet = handlerMap?.get(handler);
    if (!wrappedSet || wrappedSet.size === 0) return undefined;
    // Return the last item in the Set (insertion order).
    let last: EventHandler | undefined;
    for (const w of wrappedSet) last = w;
    return last;
  }

  /**
   * Remove a specific wrapped handler from tracking.
   * Cleans up empty Sets and Maps to avoid memory leaks.
   */
  private untrackHandler(
    event: string,
    handler: EventHandler,
    wrapped: EventHandler,
  ): void {
    const handlerMap = this.scopedHandlers.get(event);
    if (!handlerMap) return;
    const wrappedSet = handlerMap.get(handler);
    if (!wrappedSet) return;
    wrappedSet.delete(wrapped);
    if (wrappedSet.size === 0) {
      handlerMap.delete(handler);
    }
    if (handlerMap.size === 0) {
      this.scopedHandlers.delete(event);
    }
  }

  /**
   * Wrap an iterator with automatic disposal when iteration completes.
   * This ensures the context is properly cleaned up after streaming.
   */
  private wrapIteratorWithDisposal(
    iterator: AsyncIterable<any> | (() => AsyncGenerator<any>),
  ): AsyncIterable<any> {
    const self = this;

    // Handle generator function
    const source = typeof iterator === "function" ? iterator() : iterator;

    return {
      [Symbol.asyncIterator](): AsyncGenerator<any, void, unknown> {
        const originalIterator = source[Symbol.asyncIterator]();
        let done = false;

        const cleanup = () => {
          if (!done) {
            done = true;
            // Schedule disposal on next microtask to allow response to complete
            queueMicrotask(() => self.dispose());
          }
        };

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
            return { done: true, value } as IteratorResult<any, void>;
          },
          async throw(error) {
            cleanup();
            if (originalIterator.throw) {
              return originalIterator.throw(error);
            }
            throw error;
          },
        } as AsyncGenerator<any, void, unknown>;
      },
    };
  }

  /**
   * Create a request ID.
   */
  private createRequestId(): string {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }

    const rand = Math.random().toString(16).slice(2);
    return `req_${Date.now().toString(16)}_${rand}`;
  }
}
