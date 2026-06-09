/**
 * SinwanJS Core Runtime — EventBus (EventEmitter-backed)
 *
 * Provides a production-friendly, Node.js-style event system with:
 *  - Sequential async emission (emitAsync)
 *  - Synchronous emission (emitSync)
 *  - Wildcard events ("request:*", "*")
 *  - AbortSignal-aware listeners
 *  - Metadata + tracing support
 */

import {
  EventEmitter,
  captureRejectionSymbol,
  errorMonitor,
} from "node:events";
import type { Context } from "./context/context";
import type {
  EmitOptions,
  EmitResult,
  EventHandler,
  EventMeta,
  ListenerOptions,
} from "./types";

export interface EventBusOptions {
  captureRejections?: boolean;
  maxListeners?: number;
  enableWildcards?: boolean;
  wildcardDelimiter?: string;
  /** Maximum cache entries for dispatch events. Default: 500. Set to 0 to disable. */
  maxDispatchCacheSize?: number;
  /** Maximum cache entries for hasListeners checks. Default: 500. Set to 0 to disable. */
  maxHasListenersCacheSize?: number;
}

export class EventBus {
  private readonly emitter: EventEmitter;
  private readonly options: Required<
    Pick<
      EventBusOptions,
      | "enableWildcards"
      | "wildcardDelimiter"
      | "maxDispatchCacheSize"
      | "maxHasListenersCacheSize"
    >
  > &
    EventBusOptions;
  private sequence: number = 0;

  // LRU cache for dispatch events with access order tracking
  private readonly dispatchCache: Map<string, string[]>;
  private readonly dispatchAccessOrder: string[] = [];

  // LRU cache for hasListeners checks with version tracking
  private readonly hasListenersCache: Map<
    string,
    { value: boolean; version: number }
  > = new Map();
  private readonly hasListenersAccessOrder: string[] = [];
  private hasListenersCacheVersion: number = 0;

  private readonly abortHandlers = new WeakMap<
    (...args: any[]) => void,
    { signal: AbortSignal; abortHandler: () => void }
  >();

  constructor(options: EventBusOptions = {}) {
    this.options = {
      enableWildcards: options.enableWildcards !== false,
      wildcardDelimiter: options.wildcardDelimiter ?? ":",
      maxDispatchCacheSize: options.maxDispatchCacheSize ?? 500,
      maxHasListenersCacheSize: options.maxHasListenersCacheSize ?? 500,
      ...options,
    };

    this.emitter = new EventEmitter({
      captureRejections: options.captureRejections ?? false,
    });

    // Guard against unbounded listener growth (memory leak protection)
    this.emitter.setMaxListeners(options.maxListeners ?? 100);

    // Initialize dispatch cache (disabled if size is 0)
    this.dispatchCache =
      this.options.maxDispatchCacheSize > 0 ? new Map() : new Map();
  }

  // ─── Listener Management (Node-style) ────────────────────

  on<E extends string>(
    event: E,
    handler: EventHandler<E>,
    options?: ListenerOptions,
  ): this;
  on(
    event: symbol,
    handler: (...args: any[]) => void,
    options?: ListenerOptions,
  ): this;
  on(
    event: string,
    handler: (...args: any[]) => void,
    options?: ListenerOptions,
  ): this;
  on(
    event: string | symbol,
    handler: (...args: any[]) => void,
    options?: ListenerOptions,
  ): this;
  on(
    event: string | symbol,
    handler: (...args: any[]) => void,
    options?: ListenerOptions,
  ): this {
    if (options?.signal?.aborted) return this;

    const wrapped = this.wrapWithCleanup(event, handler, options, false);
    this.emitter.on(event, wrapped);
    this.invalidateHasListenersFor(event);
    return this;
  }

  addListener<E extends string>(
    event: E,
    handler: EventHandler<E>,
    options?: ListenerOptions,
  ): this;
  addListener(
    event: symbol,
    handler: (...args: any[]) => void,
    options?: ListenerOptions,
  ): this;
  addListener(
    event: string | symbol,
    handler: (...args: any[]) => void,
    options?: ListenerOptions,
  ): this {
    return this.on(event, handler as any, options);
  }

  once<E extends string>(
    event: E,
    handler: EventHandler<E>,
    options?: ListenerOptions,
  ): this;
  once(
    event: symbol,
    handler: (...args: any[]) => void,
    options?: ListenerOptions,
  ): this;
  once(
    event: string | symbol,
    handler: (...args: any[]) => void,
    options?: ListenerOptions,
  ): this {
    if (options?.signal?.aborted) return this;

    const wrapped = this.wrapWithCleanup(event, handler, options, true);
    this.emitter.once(event, wrapped);
    this.invalidateHasListenersFor(event);
    return this;
  }

  prependListener<E extends string>(
    event: E,
    handler: EventHandler<E>,
    options?: ListenerOptions,
  ): this;
  prependListener(
    event: symbol,
    handler: (...args: any[]) => void,
    options?: ListenerOptions,
  ): this;
  prependListener(
    event: string | symbol,
    handler: (...args: any[]) => void,
    options?: ListenerOptions,
  ): this {
    if (options?.signal?.aborted) return this;

    const wrapped = this.wrapWithCleanup(event, handler, options, false);
    this.emitter.prependListener(event, wrapped);
    this.invalidateHasListenersFor(event);
    return this;
  }

  prependOnceListener<E extends string>(
    event: E,
    handler: EventHandler<E>,
    options?: ListenerOptions,
  ): this;
  prependOnceListener(
    event: symbol,
    handler: (...args: any[]) => void,
    options?: ListenerOptions,
  ): this;
  prependOnceListener(
    event: string | symbol,
    handler: (...args: any[]) => void,
    options?: ListenerOptions,
  ): this {
    if (options?.signal?.aborted) return this;

    const wrapped = this.wrapWithCleanup(event, handler, options, true);
    this.emitter.prependOnceListener(event, wrapped);
    this.invalidateHasListenersFor(event);
    return this;
  }

  off(event: string | symbol, handler: (...args: any[]) => void): this {
    // We need to find if we have a wrapped version of this handler
    // Since we don't store a map of original -> wrapped for all handlers (that would be expensive),
    // we only do it for those with AbortSignals.
    const entry = this.abortHandlers.get(handler);
    if (entry) {
      entry.signal.removeEventListener("abort", entry.abortHandler);
      this.abortHandlers.delete(handler);
    }
    this.emitter.off(event, handler);
    this.invalidateHasListenersFor(event);
    return this;
  }

  removeListener(
    event: string | symbol,
    handler: (...args: any[]) => void,
  ): this {
    return this.off(event, handler);
  }

  removeAllListeners(event?: string | symbol): this {
    this.emitter.removeAllListeners(event);
    if (event) this.invalidateHasListenersFor(event);
    else this.invalidateCaches();
    return this;
  }

  eventNames(): Array<string | symbol> {
    return this.emitter.eventNames();
  }

  listenerCount(event: string | symbol): number {
    return this.emitter.listenerCount(event);
  }

  rawListeners(event: string | symbol): Array<(...args: any[]) => void> {
    return this.emitter.rawListeners(event) as Array<(...args: any[]) => void>;
  }

  setMaxListeners(count: number): this {
    this.emitter.setMaxListeners(count);
    return this;
  }

  getMaxListeners(): number {
    return this.emitter.getMaxListeners();
  }

  private invalidateCaches(): void {
    this.hasListenersCacheVersion += 1;
  }

  private invalidateHasListenersFor(event: string | symbol): void {
    this.hasListenersCacheVersion += 1;
    const key = String(event);

    if (this.options.enableWildcards) {
      if (key === "*") {
        // Global wildcard affects every cached entry
        this.hasListenersCache.clear();
        this.hasListenersAccessOrder.length = 0;
        return;
      }
      const delim = this.options.wildcardDelimiter;
      if (key.includes(delim) && key.endsWith("*")) {
        // Namespace wildcard — drop every cached event under this prefix
        const prefix = key.slice(0, -1); // e.g. "request:"
        const keep: string[] = [];
        for (const k of this.hasListenersAccessOrder) {
          if (!k.startsWith(prefix)) keep.push(k);
        }
        this.hasListenersAccessOrder.splice(
          0,
          this.hasListenersAccessOrder.length,
          ...keep,
        );
        for (const stale of this.hasListenersCache.keys()) {
          if (stale.startsWith(prefix)) this.hasListenersCache.delete(stale);
        }
        return;
      }
    }

    // Exact event change only invalidates that exact key
    if (this.hasListenersCache.has(key)) {
      this.hasListenersCache.delete(key);
      const idx = this.hasListenersAccessOrder.indexOf(key);
      if (idx !== -1) this.hasListenersAccessOrder.splice(idx, 1);
    }
  }

  // ─── Fast-Path Check ───────────────────────────────────

  /**
   * Fast check: returns true only when at least one listener would fire
   * for this event (including wildcard matches). Does NOT allocate.
   * Use this to skip emitAsync/emitSync entirely on the hot path.
   */
  hasListeners(event: string): boolean {
    // Skip caching if disabled
    if (this.options.maxHasListenersCacheSize === 0) {
      return this.computeHasListeners(event);
    }

    const cached = this.hasListenersCache.get(event);
    if (cached && cached.version === this.hasListenersCacheVersion) {
      // Update access order for LRU
      this.updateAccessOrder(this.hasListenersAccessOrder, event);
      return cached.value;
    }

    const result = this.computeHasListeners(event);

    // LRU eviction before adding new entry
    const maxSize = this.options.maxHasListenersCacheSize;
    if (this.hasListenersCache.size >= maxSize) {
      const oldest = this.hasListenersAccessOrder.shift();
      if (oldest) this.hasListenersCache.delete(oldest);
    }

    this.hasListenersCache.set(event, {
      value: result,
      version: this.hasListenersCacheVersion,
    });
    this.hasListenersAccessOrder.push(event);
    return result;
  }

  private computeHasListeners(event: string): boolean {
    if (this.emitter.listenerCount(event) > 0) return true;
    if (!this.options.enableWildcards) return false;
    // Check the global wildcard
    if (this.emitter.listenerCount("*") > 0) return true;
    // Check namespace wildcards (e.g. "request:*" for "request:start")
    const delimiter = this.options.wildcardDelimiter;
    if (!delimiter) return false;

    let idx = event.lastIndexOf(delimiter);
    while (idx > 0) {
      const wildcard = event.slice(0, idx) + delimiter + "*";
      if (this.emitter.listenerCount(wildcard) > 0) return true;
      idx = event.lastIndexOf(delimiter, idx - 1);
    }
    return false;
  }

  // ─── Emission ───────────────────────────────────────────

  async emitAsync(
    event: string,
    ctx: Context,
    payload?: unknown,
    options?: EmitOptions,
  ): Promise<EmitResult> {
    return this.emitInternalAsync(event, ctx, payload, options);
  }

  /**
   * Parallel emission: fires all listeners concurrently.
   * Does NOT respect STOP signals (cannot halt a parallel batch).
   * Useful for logging, metrics, and side-effects.
   */
  async emitParallel(
    event: string,
    ctx: Context,
    payload?: unknown,
    options?: EmitOptions,
  ): Promise<void> {
    const dispatchEvents = this.getDispatchEvents(event);
    const promises: Promise<any>[] = [];

    for (let i = 0; i < dispatchEvents.length; i++) {
      const dispatchEvent = dispatchEvents[i]!;
      const listeners = this.emitter.rawListeners(dispatchEvent);
      if (listeners.length === 0) continue;

      const meta = this.buildMeta(dispatchEvent, event, ctx, options);
      this.trace(ctx, meta, payload);

      for (let j = 0; j < listeners.length; j++) {
        const listener = listeners[j]!;
        try {
          const result = listener.call(this.emitter, ctx, payload, meta);
          if ((result as any) instanceof Promise)
            promises.push(result as unknown as Promise<unknown>);
        } catch (error) {
          this.emitErrorMonitor(error, ctx, meta);
        }
      }
    }

    if (promises.length > 0) await Promise.all(promises);
  }

  emitSync(
    event: string,
    ctx: Context,
    payload?: unknown,
    options?: EmitOptions,
  ): EmitResult {
    return this.emitInternalSync(event, ctx, payload, options);
  }

  private async emitInternalAsync(
    event: string,
    ctx: Context,
    payload: unknown,
    options?: EmitOptions,
  ): Promise<EmitResult> {
    const dispatchEvents = this.getDispatchEvents(event);

    for (
      let dispatchIndex = 0;
      dispatchIndex < dispatchEvents.length;
      dispatchIndex += 1
    ) {
      const dispatchEvent = dispatchEvents[dispatchIndex];
      if (!dispatchEvent) continue;

      const listeners = this.emitter.rawListeners(dispatchEvent);
      if (listeners.length === 0) continue;

      const meta = this.buildMeta(dispatchEvent, event, ctx, options);
      this.trace(ctx, meta, payload);

      if (dispatchEvent === "error") {
        this.emitErrorMonitor(payload, ctx, meta);
      }

      for (
        let listenerIndex = 0;
        listenerIndex < listeners.length;
        listenerIndex += 1
      ) {
        const listener = listeners[listenerIndex];
        if (!listener) continue;

        if (ctx.isStopped()) return "STOP";

        try {
          const result = listener.call(
            this.emitter,
            ctx,
            payload,
            meta,
          ) as unknown;
          const resolved = await result;
          if (resolved === "STOP") return "STOP";
          if (ctx.isStopped()) return "STOP";
        } catch (error) {
          this.handleRejection(error, dispatchEvent, ctx, payload, meta);
          throw error;
        }
      }
    }

    return "CONTINUE";
  }

  private emitInternalSync(
    event: string,
    ctx: Context,
    payload: unknown,
    options?: EmitOptions,
  ): EmitResult {
    const dispatchEvents = this.getDispatchEvents(event);

    for (
      let dispatchIndex = 0;
      dispatchIndex < dispatchEvents.length;
      dispatchIndex += 1
    ) {
      const dispatchEvent = dispatchEvents[dispatchIndex];
      if (!dispatchEvent) continue;

      const listeners = this.emitter.rawListeners(dispatchEvent);
      if (listeners.length === 0) continue;

      const meta = this.buildMeta(dispatchEvent, event, ctx, options);
      this.trace(ctx, meta, payload);

      if (dispatchEvent === "error") {
        this.emitErrorMonitor(payload, ctx, meta);
      }

      for (
        let listenerIndex = 0;
        listenerIndex < listeners.length;
        listenerIndex += 1
      ) {
        const listener = listeners[listenerIndex];
        if (!listener) continue;

        if (ctx.isStopped()) return "STOP";

        try {
          const result = listener.call(
            this.emitter,
            ctx,
            payload,
            meta,
          ) as unknown;

          if (
            typeof result === "object" &&
            result !== null &&
            typeof (result as Promise<unknown>).then === "function"
          ) {
            console.warn(
              `[EventBus] emitSync: handler for "${dispatchEvent}" returned a Promise. ` +
                `Async handlers must be registered with emitAsync(). ` +
                `STOP signals from this handler will be ignored.`,
            );
          }

          if (result === "STOP") return "STOP";
          if (ctx.isStopped()) return "STOP";
        } catch (error) {
          this.emitErrorMonitor(error, ctx, meta);
          throw error;
        }
      }
    }

    return "CONTINUE";
  }

  // ─── Helpers ────────────────────────────────────────────

  private buildMeta(
    name: string,
    event: string,
    ctx: Context,
    options?: EmitOptions,
  ): EventMeta {
    return {
      name,
      event,
      timestamp: options?.timestamp || Date.now(),
      sequence: ++this.sequence,
      requestId: options?.requestId || ctx.requestId,
      source: options?.source,
    };
  }

  private getDispatchEvents(event: string): string[] {
    // Skip caching if disabled
    if (this.options.maxDispatchCacheSize === 0) {
      return this.computeDispatchEvents(event);
    }

    let cached = this.dispatchCache.get(event);
    if (cached) {
      // Update access order for LRU
      this.updateAccessOrder(this.dispatchAccessOrder, event);
      return cached;
    }

    const events = this.computeDispatchEvents(event);

    // LRU eviction before adding new entry
    const maxSize = this.options.maxDispatchCacheSize;
    if (this.dispatchCache.size >= maxSize) {
      const oldest = this.dispatchAccessOrder.shift();
      if (oldest) this.dispatchCache.delete(oldest);
    }

    this.dispatchCache.set(event, events);
    this.dispatchAccessOrder.push(event);
    return events;
  }

  /**
   * Update access order for LRU tracking (move to end = most recently used)
   */
  private updateAccessOrder(order: string[], key: string): void {
    const idx = order.indexOf(key);
    if (idx !== -1) {
      order.splice(idx, 1);
      order.push(key);
    }
  }

  /**
   * Compute dispatch events without caching
   */
  private computeDispatchEvents(event: string): string[] {
    const events: string[] = [event];

    if (!this.options.enableWildcards || event.includes("*")) {
      return events;
    }

    const delimiter = this.options.wildcardDelimiter;
    if (delimiter && event.includes(delimiter)) {
      const parts = event.split(delimiter);
      for (let i = parts.length - 1; i >= 1; i -= 1) {
        const prefix = parts.slice(0, i).join(delimiter);
        events.push(`${prefix}${delimiter}*`);
      }
    }

    if (!events.includes("*")) events.push("*");
    return events;
  }

  private wrapWithCleanup(
    event: string | symbol,
    handler: (...args: any[]) => void,
    options: ListenerOptions | undefined,
    isOnce: boolean,
  ): (...args: any[]) => void {
    const signal = options?.signal;
    if (!signal) return handler;

    if (signal.aborted) return () => {};

    // Define wrapped first so abortHandler can reference it
    let wrapped: (...args: any[]) => void;
    let abortHandler: () => void;
    let cleanedUp = false;

    // Cleanup function to ensure we don't double-clean
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      signal.removeEventListener("abort", abortHandler);
      this.abortHandlers.delete(handler);
    };

    abortHandler = () => {
      cleanup();
      this.emitter.off(event, wrapped);
    };

    wrapped = (...args: any[]) => {
      cleanup();
      return handler(...args);
    };

    // Register abort listener
    signal.addEventListener("abort", abortHandler, { once: true });

    // Store for manual cleanup via off()
    this.abortHandlers.set(handler, { signal, abortHandler });

    // Copy properties for identification
    Object.defineProperty(wrapped, "name", { value: handler.name });

    return wrapped;
  }

  private trace(ctx: Context, meta: EventMeta, payload: unknown): void {
    if (typeof (ctx as Context).recordEvent === "function") {
      ctx.recordEvent(meta, payload);
    }
  }

  private emitErrorMonitor(
    error: unknown,
    ctx: Context,
    meta: EventMeta,
  ): void {
    const listeners = this.emitter.rawListeners(errorMonitor);
    for (let i = 0; i < listeners.length; i++) {
      const listener = listeners[i]!;
      try {
        listener.call(this.emitter, error, ctx, meta);
      } catch {
        // Monitoring should not interfere
      }
    }
  }

  private handleRejection(
    error: unknown,
    event: string,
    ctx: Context,
    payload: unknown,
    meta: EventMeta,
  ): void {
    if (!this.options.captureRejections) return;

    const handler = (this.emitter as any)[captureRejectionSymbol];
    if (typeof handler === "function") {
      try {
        handler.call(this.emitter, error, event, ctx, payload, meta);
        return;
      } catch {}
    }

    this.emitErrorMonitor(error, ctx, meta);
  }
}
