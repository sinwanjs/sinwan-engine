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
import type { Context } from "./context";
import type {
  EmitOptions,
  EmitResult,
  EventBusOptions,
  EventHandler,
  EventMeta,
  ListenerOptions,
} from "./types";

export class EventBus {
  private readonly emitter: EventEmitter;
  private readonly options: Required<
    Pick<EventBusOptions, "enableWildcards" | "wildcardDelimiter">
  > &
    EventBusOptions;
  private sequence: number = 0;

  constructor(options: EventBusOptions = {}) {
    this.options = {
      enableWildcards: options.enableWildcards !== false,
      wildcardDelimiter: options.wildcardDelimiter ?? ":",
      ...options,
    };

    this.emitter = new EventEmitter({
      captureRejections: options.captureRejections ?? false,
    });

    if (options.maxListeners !== undefined) {
      this.emitter.setMaxListeners(options.maxListeners);
    }
  }

  // ─── Listener Management (Node-style) ────────────────────

  on(event: string, handler: EventHandler, options?: ListenerOptions): this;
  on(
    event: symbol,
    handler: (...args: any[]) => void,
    options?: ListenerOptions,
  ): this;
  on(
    event: string | symbol,
    handler: (...args: any[]) => void,
    options?: ListenerOptions,
  ): this {
    this.emitter.on(event, handler);
    this.attachAbort(event, handler, options);
    return this;
  }

  addListener(
    event: string,
    handler: EventHandler,
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
    this.emitter.on(event, handler);
    this.attachAbort(event, handler, options);
    return this;
  }

  once(event: string, handler: EventHandler, options?: ListenerOptions): this;
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

    this.emitter.once(event, handler);
    this.attachAbort(event, handler, options, true);
    return this;
  }

  prependListener(
    event: string,
    handler: EventHandler,
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
    this.emitter.prependListener(event, handler);
    this.attachAbort(event, handler, options);
    return this;
  }

  prependOnceListener(
    event: string,
    handler: EventHandler,
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

    this.emitter.prependOnceListener(event, handler);
    this.attachAbort(event, handler, options, true);
    return this;
  }

  off(event: string | symbol, handler: (...args: any[]) => void): this {
    this.emitter.off(event, handler);
    return this;
  }

  removeListener(
    event: string | symbol,
    handler: (...args: any[]) => void,
  ): this {
    this.emitter.removeListener(event, handler);
    return this;
  }

  removeAllListeners(event?: string | symbol): this {
    this.emitter.removeAllListeners(event);
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

  // ─── Emission ───────────────────────────────────────────

  async emitAsync(
    event: string,
    ctx: Context,
    payload?: unknown,
    options?: EmitOptions,
  ): Promise<EmitResult> {
    return this.emitInternalAsync(event, ctx, payload, options);
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

    for (const dispatchEvent of dispatchEvents) {
      const listeners = this.emitter.rawListeners(dispatchEvent);
      if (listeners.length === 0) continue;

      const meta = this.buildMeta(dispatchEvent, event, ctx, options);
      this.trace(ctx, meta, payload);

      if (dispatchEvent === "error") {
        this.emitErrorMonitor(payload, ctx, meta);
      }

      for (const listener of listeners) {
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

    for (const dispatchEvent of dispatchEvents) {
      const listeners = this.emitter.rawListeners(dispatchEvent);
      if (listeners.length === 0) continue;

      const meta = this.buildMeta(dispatchEvent, event, ctx, options);
      this.trace(ctx, meta, payload);

      if (dispatchEvent === "error") {
        this.emitErrorMonitor(payload, ctx, meta);
      }

      for (const listener of listeners) {
        if (ctx.isStopped()) return "STOP";

        try {
          const result = listener.call(
            this.emitter,
            ctx,
            payload,
            meta,
          ) as unknown;
          if (result === "STOP") return "STOP";
          if (ctx.isStopped()) return "STOP";
        } catch (error) {
          this.handleRejection(error, dispatchEvent, ctx, payload, meta);
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
      timestamp: options?.timestamp ?? Date.now(),
      sequence: ++this.sequence,
      requestId: options?.requestId ?? ctx.requestId,
      source: options?.source,
    };
  }

  private getDispatchEvents(event: string): string[] {
    const events: string[] = [event];

    if (!this.options.enableWildcards) return events;
    if (event.includes("*")) return events;

    const delimiter = this.options.wildcardDelimiter;
    if (delimiter && event.includes(delimiter)) {
      const parts = event.split(delimiter);
      for (let i = parts.length - 1; i >= 1; i -= 1) {
        const prefix = parts.slice(0, i).join(delimiter);
        const wildcard = `${prefix}${delimiter}*`;
        if (!events.includes(wildcard)) events.push(wildcard);
      }
    }

    if (!events.includes("*")) events.push("*");
    return events;
  }

  private attachAbort(
    event: string | symbol,
    handler: (...args: any[]) => void,
    options?: ListenerOptions,
    isOnce: boolean = false,
  ): void {
    const signal = options?.signal;
    if (!signal) return;

    if (signal.aborted) {
      this.emitter.off(event, handler);
      return;
    }

    const abortHandler = () => this.emitter.off(event, handler);
    signal.addEventListener("abort", abortHandler, { once: true });

    if (isOnce) {
      const cleanup = () => signal.removeEventListener("abort", abortHandler);
      this.emitter.once(event, cleanup);
    }
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
    for (const listener of listeners) {
      try {
        listener.call(this.emitter, error, ctx, meta);
      } catch {
        // Monitoring should not interfere with runtime execution
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

    const handler = (
      this.emitter as unknown as {
        [captureRejectionSymbol]?: (...args: any[]) => void;
      }
    )[captureRejectionSymbol];
    if (typeof handler === "function") {
      try {
        handler.call(this.emitter, error, event, ctx, payload, meta);
        return;
      } catch {
        // Fall through to error monitor
      }
    }

    this.emitErrorMonitor(error, ctx, meta);
  }
}
