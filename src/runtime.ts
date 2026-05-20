/**
 * SinwanJS Core Runtime — Runtime Orchestrator
 *
 * Top-level composition of StepEngine, EventBus, and ErrorHandler.
 */

import { Context } from "./context";
import { buildResponse } from "./response";
import type { ErrorHandler } from "./error-handler";
import type { EventBus } from "./event-bus";
import type { StepEngine } from "./step-engine";
import type { Plugin } from "./types";
import type { Request } from "./types";
import type { Server } from "bun";

export interface RuntimeConfig {
  engine: StepEngine;
  bus: EventBus;
  errorHandler: ErrorHandler;
  globalState: Map<string, any>;
  maxPoolSize?: number;
}

export class Runtime {
  public readonly engine: StepEngine;
  public readonly bus: EventBus;
  public readonly errorHandler: ErrorHandler;
  private readonly globalState: Map<string, any>;
  private readonly contextPool: Context[] = [];
  private readonly maxPoolSize: number;

  private readonly runtimeEmitOptions = { source: "runtime" as const };

  constructor(params: RuntimeConfig) {
    this.engine = params.engine;
    this.bus = params.bus;
    this.errorHandler = params.errorHandler;
    this.globalState = params.globalState;
    this.maxPoolSize = params.maxPoolSize ?? 1000;
  }

  /**
   * Install a Plugin.
   */
  use(plugin: Plugin): void {
    plugin.install(this);
  }

  /**
   * The main fetch handler for Bun.serve()
   * Automatically creates or reuses a Context, executes the pipeline, and returns a Response.
   */
  fetch(req: Request, server?: Server<any>): Response | Promise<Response> {
    const ctx = this.acquireContext(server);
    ctx.setReq(req);

    const bus = this.bus;
    const hasEnd = bus.hasListeners("request:end");
    const startTime = hasEnd ? performance.now() : 0;

    // Fast-path: check if we can run synchronously
    const hasStart = bus.hasListeners("request:start");

    try {
      if (hasStart) {
        return (async () => {
          try {
            const startResult = await bus.emitAsync(
              "request:start",
              ctx,
              { method: req.method, url: req.url },
              this.runtimeEmitOptions,
            );
            if (startResult === "STOP" || ctx.isStopped()) {
              return this.finalizeResponse(ctx, startTime);
            }
            const runResult = this.engine.run(ctx, bus);
            if (runResult instanceof Promise) await runResult;
            return this.finalizeResponse(ctx, startTime);
          } catch (error: unknown) {
            await this.handleError(ctx, error);
            return this.finalizeResponse(ctx, startTime);
          }
        })();
      }

      const runResult = this.engine.run(ctx, bus);
      if (runResult instanceof Promise) {
        return (async () => {
          try {
            await runResult;
            return this.finalizeResponse(ctx, startTime);
          } catch (error: unknown) {
            await this.handleError(ctx, error);
            return this.finalizeResponse(ctx, startTime);
          }
        })();
      }

      return this.finalizeResponse(ctx, startTime);
    } catch (error: unknown) {
      // Sync error in runResult or before runResult
      return (async () => {
        await this.handleError(ctx, error);
        return this.finalizeResponse(ctx, startTime);
      })();
    }
  }

  private finalizeResponse(ctx: Context, startTime: number): Response {
    if (!ctx.hasResponded()) {
      ctx.json({ error: "No response was produced." }, 500);
    }

    const res = buildResponse(ctx);

    // Ensure request:end fires
    if (startTime > 0) {
      const durationMs = performance.now() - startTime;
      if (this.bus.hasListeners("request:end")) {
        // We use emitSync here to avoid creating more promises in the finalization phase.
        // Tracing/Metrics listeners should generally be sync or handle their own async.
        this.bus.emitSync(
          "request:end",
          ctx,
          { durationMs },
          this.runtimeEmitOptions,
        );
      }
    }

    const body = ctx.body;
    // Check if body is a stream or iterator that needs the context to stay alive
    const isPersistent =
      body instanceof ReadableStream ||
      (body &&
        typeof body === "object" &&
        (Symbol.asyncIterator in body || (body as any)._isSSE));

    if (!isPersistent) {
      this.releaseContext(ctx);
    } else {
      // The Context itself must handle its own release when the stream closes.
      // We'll implement a 'dispose' hook in Context.
      ctx.onDispose(() => this.releaseContext(ctx));
    }

    return res;
  }

  private async handleError(ctx: Context, error: unknown): Promise<void> {
    const bus = this.bus;
    if (bus.hasListeners("request:error")) {
      try {
        await bus.emitAsync(
          "request:error",
          ctx,
          { error },
          this.runtimeEmitOptions,
        );
      } catch {}
    }
    if (bus.hasListeners("error")) {
      try {
        await bus.emitAsync("error", ctx, error, this.runtimeEmitOptions);
      } catch {}
    }
    await this.errorHandler.handle(error, ctx);
  }

  acquireContext(server?: Server<any>): Context {
    const ctx = this.contextPool.pop();
    if (ctx) {
      ctx.reset({
        bus: this.bus,
        server,
        global: this.globalState,
      });
      return ctx;
    }
    return new Context({
      bus: this.bus,
      server,
      global: this.globalState,
    });
  }

  releaseContext(ctx: Context): void {
    if (this.contextPool.length < this.maxPoolSize) {
      this.contextPool.push(ctx);
    }
  }
}
