/**
 * SinwanJS Core Runtime — Base Context
 *
 * Protocol-agnostic per-execution state container shared by
 * HttpContext, WsContext, TcpContext, UdpContext, and GrpcContext.
 * Holds request state, global state, flow-control flags, EventBus
 * integration, event tracing, and disposal lifecycle.
 *
 * Design:
 *  - Protocol-specific payloads (req/ws/tcp/udp/grpc) and response
 *    semantics live on the concrete subclasses, never here.
 *  - stop() halts step execution but does NOT set a response.
 *  - Context can interact with the EventBus when attached.
 */

import { randomUUIDv7 } from "bun";
import type { EventBus } from "../event-bus";
import type {
  EmitOptions,
  EmitResult,
  EventHandler,
  EventMeta,
  EventTraceEntry,
  EventTraceOptions,
  InternalEventMap,
  ListenerOptions,
} from "../types";
import type { ErrorHandler } from "../error-handler";

/** Discriminator used by the Runtime to route contexts to per-protocol pools. */
export type ContextProtocol = "http" | "ws" | "tcp" | "udp" | "grpc";

export interface ContextOptions {
  requestId?: string;
  bus?: EventBus;
  trace?: EventTraceOptions;
  server?: import("bun").Server<unknown>;
  errorHandler: ErrorHandler;
  global?: Map<string, unknown>;
}

export abstract class BaseContext {
  /** Protocol discriminator — set by each concrete context class. */
  public abstract readonly protocol: ContextProtocol;

  /**
   * The Bun Server instance (if provided).
   * Guards added in subclasses before access.
   */
  public server: import("bun").Server<unknown> | undefined;

  protected errorHandler: ErrorHandler;

  /** Arbitrary per-request state for steps/plugins. */
  private _state?: Map<string, unknown>;
  get state(): Map<string, unknown> {
    if (!this._state) this._state = new Map();
    return this._state;
  }

  /** Shared application-level state. */
  private readonly global: Map<string, unknown>;

  private _requestId: string = "";

  get requestId(): string {
    if (this._requestId === "") {
      this._requestId = `sinwan-request-${randomUUIDv7()}`;
    }
    return this._requestId;
  }

  set requestId(value: string) {
    this._requestId = value;
  }

  // ─── Internal Flags ─────────────────────────────────────

  protected _status: number = 0;
  protected static readonly STOPPED = 1 << 0;
  protected static readonly RESPONDED = 1 << 1;
  protected static readonly DISPOSED = 1 << 2;
  protected static readonly STREAMING = 1 << 3;
  protected static readonly SKIPPED = 1 << 4;
  protected static readonly RESPOND_EARLY = 1 << 5;
  protected static readonly FAILED = 1 << 6;
  private _failError: unknown = null;
  private _skipCount: number = 0;

  protected _bus?: EventBus;
  private _onDisposeCallbacks: (() => void)[] = [];
  private _released = false;

  /** @internal */
  private _meta: EventMeta = {
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

  constructor(options: ContextOptions) {
    this.server = options.server;
    if (options.requestId) this._requestId = options.requestId;
    this._bus = options.bus;

    this.traceOptions = {
      enabled: options.trace?.enabled ?? true,
      maxEntries: options.trace?.maxEntries ?? 100,
      includePayload: options.trace?.includePayload ?? false,
    };

    this.global = options.global ?? new Map();
    this.errorHandler = options.errorHandler;
  }

  /**
   * Reset the shared context state for reuse in a pool.
   * Concrete subclasses override this to also clear their
   * protocol-specific fields and must call `super.reset(options)`.
   */
  reset(options: ContextOptions): void {
    const oldBus = this._bus;

    this.server = options.server;
    this._requestId = options.requestId || "";
    this._status = 0;
    this._failError = null;
    this._skipCount = 0;
    this._bus = options.bus;
    this.errorHandler = options.errorHandler;
    this._onDisposeCallbacks.length = 0;
    this._released = false;

    // Reset meta
    this._meta.name = "";
    this._meta.event = "";
    this._meta.timestamp = 0;
    this._meta.sequence = 0;
    this._meta.requestId = options.requestId || "";
    this._meta.source = undefined;

    // Fast clear for reused objects
    if (this._state) this._state.clear();
    if (this._eventTrace) this._eventTrace.length = 0;
    this._traceStart = 0;
    this._traceSize = 0;

    // Remove scoped handlers from the old bus before clearing tracking
    if (this._scopedHandlers && this._scopedHandlers.size > 0) {
      if (oldBus) {
        for (const [event, handlerMap] of this._scopedHandlers.entries()) {
          for (const wrappedSet of handlerMap.values()) {
            for (const wrapped of wrappedSet) {
              oldBus.off(event, wrapped);
            }
          }
        }
      }
    }
    this._scopedHandlers = undefined;
  }

  /**
   * Mark this context as released to the pool.
   * Returns `true` if it was already released (double-release guard).
   */
  markReleased(): boolean {
    const wasReleased = this._released;
    this._released = true;
    return wasReleased;
  }

  // ─── State Management ───────────────────────────────────
  /** Set a value in the request state. */
  set<V>(key: string, value: V): void {
    this.state.set(key, value);
  }

  /** Get a value from the request state. */
  get<T>(key: string): T | undefined {
    return this.state.get(key) as T;
  }

  /** Get a value from the request state and remove it. */
  getOnce<T>(key: string): T | undefined {
    const value = this.state.get(key) as T | undefined;
    this.state.delete(key);
    return value;
  }

  /** Export the current state as a plain object (for WS bridge).
   * Keys starting with `_` are excluded to protect internal data. */
  exportState(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of this.state) {
      if (!key.startsWith("_")) result[key] = value;
    }
    return result;
  }

  /** Import a state snapshot into this context (from WS upgrade). */
  importState(state: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(state)) {
      this.state.set(key, value);
    }
  }

  /** Update an existing value in the request state. */
  update<T>(key: string, updater: (prev: T | undefined) => T): T {
    const nextValue = updater(this.get(key));
    this.state.set(key, nextValue);
    return nextValue;
  }

  /** Remove a value from the request state. */
  clear(key: string): boolean {
    return this.state.delete(key);
  }

  /** Remove all values from the request state. */
  clearAll(): void {
    this.state.clear();
  }

  /** Check if a value exists in the request state. */
  has(key: string): boolean {
    return this.state.has(key);
  }

  /**
   * Get a snapshot of the current request state as a readonly object.
   * This is useful for debugging and logging.
   */
  snapshot(): Readonly<Record<string, unknown>> {
    return Object.freeze(
      Object.fromEntries(this.state) as Record<string, unknown>,
    );
  }

  // ─── Global State Management ──────────────────────────────

  /** Set a value in the global application state. */
  setGlobal<V>(key: string, value: V): void {
    this.global.set(key, value);
  }

  /** Get a value from the global application state. */
  getGlobal<V>(key: string): V | undefined {
    return this.global.get(key) as V | undefined;
  }

  /** Get a value from the global application state and remove it. */
  getGlobalOnce<V>(key: string): V | undefined {
    const value = this.global.get(key) as V | undefined;
    this.global.delete(key);
    return value;
  }

  /** Update an existing value in the global application state. */
  updateGlobal<V>(key: string, updater: (prev: V | undefined) => V): V {
    const nextValue = updater(this.getGlobal(key));
    this.global.set(key, nextValue);
    return nextValue;
  }

  /** Remove a value from the global application state. */
  clearGlobal(key: string): boolean {
    return this.global.delete(key);
  }

  /** Remove all values from the global application state. */
  clearAllGlobal(): void {
    this.global.clear();
  }

  /** Check if a value exists in the global application state. */
  hasGlobal(key: string): boolean {
    return this.global.has(key);
  }

  /**
   * Get all global state as readonly object.
   * This is useful for debugging and logging.
   */
  snapshotGlobal(): Readonly<Record<string, unknown>> {
    return Object.freeze(
      Object.fromEntries(this.global) as Record<string, unknown>,
    );
  }

  // ─── Flow Control ───────────────────────────────────────

  /** Signal that step execution should halt after the current step. */
  stop(): void {
    this._status |= BaseContext.STOPPED;
    this.emitStop();
  }

  protected emitStop(): void {
    if (this._bus && this._bus.hasListeners("context:stop")) {
      this._bus.emitSync("context:stop", this, undefined, {
        source: "context",
        forceDelivery: true,
      });
    }
  }

  /** Whether stop() has been called. */
  isStopped(): boolean {
    return (this._status & BaseContext.STOPPED) !== 0;
  }

  /** Whether json() or text() has been called. */
  hasResponded(): boolean {
    return (this._status & BaseContext.RESPONDED) !== 0;
  }

  /** Whether the context has an active streaming response. */
  isStreaming(): boolean {
    return (this._status & BaseContext.STREAMING) !== 0;
  }

  /**
   * Signal that the next `count` steps should be skipped.
   *
   * The skip is consumed by `runChain` (which advances the chain index by
   * `count` and then clears the flag). Calling `skip()` multiple times
   * overwrites the previous count (last call wins), matching the idempotent
   * behavior of the underlying bitmask.
   *
   * **Note:** if a response has already been set (`ctx.json()`, `ctx.text()`,
   * etc.) or the chain has been halted (`ctx.stop()`, `ctx.respond()`), the
   * `runChain` runner checks those flags BEFORE `isSkipped()` and returns
   * early — so `skip()` will have no effect in that case. A dev-mode warning
   * is emitted when this happens.
   *
   * @param count Number of handlers to skip (default: 1). Values < 1 are no-ops.
   */
  skip(count: number = 1): void {
    if (count < 1) return;
    this._status |= BaseContext.SKIPPED;
    this._skipCount = count;
  }

  /** Whether skip() has been called. */
  isSkipped(): boolean {
    return (this._status & BaseContext.SKIPPED) !== 0;
  }

  /** The number of handlers to skip. Reset to 0 by clearSkip(). */
  get skipCount(): number {
    return this._skipCount;
  }

  /** Clear the skip flag — used by runChain to prevent skip from propagating past the current chain. */
  clearSkip(): void {
    this._status &= ~BaseContext.SKIPPED;
    this._skipCount = 0;
  }

  /** Signal an early response — halts the pipeline without setting a response body. */
  respond(): void {
    this._status |= BaseContext.RESPOND_EARLY;
  }

  /** Whether respond() has been called. */
  isRespondEarly(): boolean {
    return (this._status & BaseContext.RESPOND_EARLY) !== 0;
  }

  /** Signal a step failure with an error — halts the pipeline and throws. */
  fail(error: unknown): void {
    this._failError = error;
    this._status |= BaseContext.FAILED;
  }

  /** Whether fail() has been called. */
  isFailed(): boolean {
    return (this._status & BaseContext.FAILED) !== 0;
  }

  /** Clear the fail flag — used by runChain to prevent fail from propagating after onError handles it. */
  clearFail(): void {
    this._status &= ~BaseContext.FAILED;
    this._failError = null;
  }

  /** The error passed to fail(). Available when isFailed() is true. */
  get failError(): unknown {
    return this._failError;
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
   *
   * Scoped listeners are automatically removed when the context is disposed,
   * so they are safe to use for per-request "after" hooks without leaking:
   *
   * ```ts
   * app.use((ctx) => {
   *   // runs once when a handler commits a response
   *   ctx.once("response:set", (c, { statusCode }) => {
   *     metrics.record(statusCode);
   *   });
   * });
   * ```
   *
   * Common before/after events:
   * - `response:set` — fires when `ctx.json()` / `ctx.text()` / … commits a response.
   * - `request:end`  — fires after the response is built (app-level, not scoped).
   */
  on<E extends keyof InternalEventMap>(
    event: E,
    handler: InternalEventMap[E],
    options?: ListenerOptions,
  ): this;
  on(event: string, handler: EventHandler, options?: ListenerOptions): this;
  on(event: string, handler: EventHandler, options?: ListenerOptions): this {
    const bus = this.getBus();
    const wrapped = this.wrapScopedHandler(event, handler, false);
    bus.on(event, wrapped, options);
    this.trackHandler(event, handler, wrapped);
    return this;
  }

  /** Register a once-only listener scoped to this context. */
  once<E extends keyof InternalEventMap>(
    event: E,
    handler: InternalEventMap[E],
    options?: ListenerOptions,
  ): this;
  once(event: string, handler: EventHandler, options?: ListenerOptions): this;
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

  /**
   * Register a callback to be executed when the context is disposed.
   *
   * This is the "after response" cleanup hook — it fires after the response
   * has been built and `request:end` has been emitted, during context
   * teardown. Use it to release resources, close handles, or log final
   * state without blocking the response:
   *
   * ```ts
   * app.use((ctx) => {
   *   const handle = acquireHandle();
   *   ctx.onDispose(() => handle.release()); // runs after response is sent
   * });
   * ```
   *
   * If the context is already disposed, the callback runs immediately.
   */
  onDispose(cb: () => void): void {
    if ((this._status & BaseContext.DISPOSED) !== 0) {
      cb();
      return;
    }
    this._onDisposeCallbacks.push(cb);
  }

  /** Dispose context-scoped listeners and trigger cleanup callbacks. */
  dispose(): void {
    if ((this._status & BaseContext.DISPOSED) !== 0) return;
    this._status |= BaseContext.DISPOSED;

    // Clear streaming flag to allow pool reuse
    this._status &= ~BaseContext.STREAMING;

    if (this._bus && this._bus.hasListeners("context:dispose")) {
      this._bus.emitSync("context:dispose", this, undefined, {
        source: "context",
        forceDelivery: true,
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
  protected guardDoubleResponse(): void {
    if ((this._status & BaseContext.RESPONDED) !== 0) {
      throw new Error("Response already sent. Cannot set body more than once.");
    }
  }

  protected getBus(): EventBus {
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

  protected emitSyncIfAvailable(event: string, payload?: unknown): void {
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
}
