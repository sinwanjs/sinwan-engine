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
} from "./types";

export class Context {
  /** The incoming Bun/Web API Request. */
  public readonly req: Request;

  /** HTTP status code for the response. */
  public statusCode: number = 200;

  /** Response body — set via json() or text(). */
  public body: unknown = null;

  /** Response headers. */
  public readonly headers: Headers = new Headers();

  /** Arbitrary per-request state for steps/plugins. */
  public readonly state: Map<string, unknown> = new Map();

  /** URL parameters populated by the router (e.g. /users/:id -> params.id) */
  public params: Record<string, string> = {};

  /** Unique ID for this request context. */
  public requestId: string;

  // ─── Internal Flags ─────────────────────────────────────

  private _stopped: boolean = false;
  private _responded: boolean = false;
  private _parsedBody: unknown = undefined;
  private _bus?: EventBus;
  private _disposed: boolean = false;

  private readonly services: Map<string, unknown>;
  private readonly traceOptions: Required<EventTraceOptions>;
  private readonly eventTrace: EventTraceEntry[] = [];
  private readonly scopedHandlers: Map<
    string,
    Map<EventHandler, EventHandler>
  > = new Map();

  constructor(
    req: Request,
    services: Map<string, unknown> = new Map(),
    options: ContextOptions = {},
  ) {
    this.req = req;
    this.services = services;
    this.requestId = options.requestId ?? createRequestId();
    this._bus = options.bus;

    this.traceOptions = {
      enabled: options.trace?.enabled ?? true,
      maxEntries: options.trace?.maxEntries ?? 100,
      includePayload: options.trace?.includePayload ?? false,
    };
  }

  // ─── Response Methods ───────────────────────────────────

  /**
   * Set a JSON response body.
   * Throws if a response has already been set.
   */
  json(data: unknown, status?: number): void {
    this.guardDoubleResponse();
    this.body = data;
    this.statusCode = status ?? this.statusCode;
    this.headers.set("Content-Type", "application/json");
    this._responded = true;
    this.emitSyncIfAvailable("response:set", {
      kind: "json",
      statusCode: this.statusCode,
      contentType: "application/json",
    });
  }

  /**
   * Set a plain-text response body.
   * Throws if a response has already been set.
   */
  text(data: string, status?: number): void {
    this.guardDoubleResponse();
    this.body = data;
    this.statusCode = status ?? this.statusCode;
    this.headers.set("Content-Type", "text/plain");
    this._responded = true;
    this.emitSyncIfAvailable("response:set", {
      kind: "text",
      statusCode: this.statusCode,
      contentType: "text/plain",
    });
  }

  /** Set a streaming response body. */
  stream(
    readable: ReadableStream,
    status?: number,
    contentType: string = "application/octet-stream",
  ): void {
    this.guardDoubleResponse();
    this.body = readable;
    this.statusCode = status ?? this.statusCode;
    this.headers.set("Content-Type", contentType);
    this._responded = true;
    this.emitSyncIfAvailable("response:set", {
      kind: "stream",
      statusCode: this.statusCode,
      contentType,
    });
  }

  /** Set a binary buffer response body. */
  buffer(
    data: Uint8Array | ArrayBuffer,
    status?: number,
    contentType: string = "application/octet-stream",
  ): void {
    this.guardDoubleResponse();
    this.body = data;
    this.statusCode = status ?? this.statusCode;
    this.headers.set("Content-Type", contentType);
    this._responded = true;
    this.emitSyncIfAvailable("response:set", {
      kind: "buffer",
      statusCode: this.statusCode,
      contentType,
    });
  }

  /** Append or overwrite a single response header. */
  setHeader(key: string, value: string): void {
    this.headers.set(key, value);
    this.emitSyncIfAvailable("header:set", { key, value });
  }

  // ─── State Helpers ──────────────────────────────────────

  /** Get a value from the request state. */
  get<T>(key: string): T | undefined {
    return this.state.get(key) as T | undefined;
  }

  /** Set a value in the request state. */
  set(key: string, value: unknown): void {
    this.state.set(key, value);
  }

  /** Get an app-wide service injected by DI. */
  service<T>(name: string): T {
    const s = this.services.get(name);
    if (!s) throw new Error(`Service "${name}" not found in DI container.`);
    return s as T;
  }

  // ─── Utilities ──────────────────────────────────────────

  /**
   * Safely read and parse the request body based on Content-Type.
   * Caches the result so it can be called multiple times.
   */
  async parseBody<T = unknown>(): Promise<T> {
    if (this._parsedBody !== undefined) return this._parsedBody as T;

    const contentType = this.req.headers.get("content-type") || "";
    let kind: "json" | "form" | "text" = "text";

    try {
      if (contentType.includes("application/json")) {
        kind = "json";
        this._parsedBody = await this.req.clone().json();
      } else if (
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("multipart/form-data")
      ) {
        kind = "form";
        // We clone to allow multiple readers
        const fd = await this.req.clone().formData();
        const obj: Record<string, unknown> = {};
        for (const [k, v] of fd.entries()) {
          obj[k] = v;
        }
        this._parsedBody = obj;
      } else {
        kind = "text";
        this._parsedBody = await this.req.clone().text();
      }
    } catch (err) {
      const error = Object.assign(new Error("Failed to parse request body"), {
        statusCode: 400,
      });
      this.emitSyncIfAvailable("body:parse:error", { error });
      throw error;
    }

    this.emitSyncIfAvailable("body:parsed", { kind });
    return this._parsedBody as T;
  }

  // ─── Flow Control ───────────────────────────────────────

  /** Signal that step execution should halt after the current step. */
  stop(): void {
    this._stopped = true;
    this.emitSyncIfAvailable("context:stop");
  }

  /** Whether stop() has been called. */
  isStopped(): boolean {
    return this._stopped;
  }

  /** Whether json() or text() has been called. */
  hasResponded(): boolean {
    return this._responded;
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

  /** Register a listener scoped to this context. */
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

  /** Remove a scoped listener. */
  off(event: string, handler: EventHandler): this {
    const bus = this.getBus();
    const wrapped = this.getTrackedHandler(event, handler);
    if (wrapped) {
      bus.off(event, wrapped);
      this.untrackHandler(event, handler);
    }
    return this;
  }

  /** Dispose context-scoped listeners. */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    this.emitSyncIfAvailable("context:dispose");

    if (!this._bus) return;
    for (const [event, handlerMap] of this.scopedHandlers.entries()) {
      for (const wrapped of handlerMap.values()) {
        this._bus.off(event, wrapped);
      }
    }
    this.scopedHandlers.clear();
  }

  /** Access a copy of the event trace for this context. */
  getEventTrace(): readonly EventTraceEntry[] {
    return this.eventTrace;
  }

  /** Record an event trace entry (used by EventBus). */
  recordEvent(meta: EventMeta, payload: unknown): void {
    if (!this.traceOptions.enabled) return;

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

    this.eventTrace.push(entry);
    if (this.eventTrace.length > this.traceOptions.maxEntries) {
      this.eventTrace.splice(
        0,
        this.eventTrace.length - this.traceOptions.maxEntries,
      );
    }
  }

  // ─── Guards ─────────────────────────────────────────────

  /** Throws if a response body has already been committed. */
  private guardDoubleResponse(): void {
    if (this._responded) {
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
    return (ctx, payload, meta) => {
      if (ctx !== this) return;
      if (isOnce) {
        this.untrackHandler(event, handler);
      }
      return handler(ctx, payload, meta);
    };
  }

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
    handlerMap.set(handler, wrapped);
  }

  private getTrackedHandler(
    event: string,
    handler: EventHandler,
  ): EventHandler | undefined {
    const handlerMap = this.scopedHandlers.get(event);
    return handlerMap?.get(handler);
  }

  private untrackHandler(event: string, handler: EventHandler): void {
    const handlerMap = this.scopedHandlers.get(event);
    if (!handlerMap) return;
    handlerMap.delete(handler);
    if (handlerMap.size === 0) {
      this.scopedHandlers.delete(event);
    }
  }
}

function createRequestId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  const rand = Math.random().toString(16).slice(2);
  return `req_${Date.now().toString(16)}_${rand}`;
}
