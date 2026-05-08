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

interface RuntimeParams {
  engine: StepEngine;
  bus: EventBus;
  errorHandler: ErrorHandler;
  globalState: Map<string, any>;
}

export class Runtime {
  public readonly engine: StepEngine;
  public readonly bus: EventBus;
  public readonly errorHandler: ErrorHandler;
  private readonly globalState: Map<string, any>;
  private readonly contextPool: Context[] = [];
  private readonly maxPoolSize: number = 1000;

  // Reusable event payloads to avoid allocations
  private readonly startPayload = { method: "", url: "" };
  private readonly endPayload = { durationMs: 0 };
  private readonly runtimeEmitOptions = { source: "runtime" as const };

  constructor(params: RuntimeParams) {
    this.engine = params.engine;
    this.bus = params.bus;
    this.errorHandler = params.errorHandler;
    this.globalState = params.globalState;
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

    try {
      if (bus.hasListeners("request:start")) {
        this.startPayload.method = req.method;
        this.startPayload.url = req.url;
        return (async () => {
          try {
            const startResult = await bus.emitAsync(
              "request:start",
              ctx,
              this.startPayload,
              this.runtimeEmitOptions,
            );
            if (startResult === "STOP" || ctx.isStopped()) {
              return this.finalizeResponse(ctx);
            }
            const runResult = this.engine.run(ctx, bus);
            if (runResult instanceof Promise) await runResult;
            if (hasEnd && !ctx.isStopped()) {
              this.endPayload.durationMs = performance.now() - startTime;
              await bus.emitAsync(
                "request:end",
                ctx,
                this.endPayload,
                this.runtimeEmitOptions,
              );
            }
            return this.finalizeResponse(ctx);
          } catch (error: unknown) {
            await this.handleError(ctx, error);
            return this.finalizeResponse(ctx);
          }
        })();
      }

      const runResult = this.engine.run(ctx, bus);
      if (runResult instanceof Promise) {
        return (async () => {
          try {
            await runResult;
            if (hasEnd && !ctx.isStopped()) {
              this.endPayload.durationMs = performance.now() - startTime;
              await bus.emitAsync(
                "request:end",
                ctx,
                this.endPayload,
                this.runtimeEmitOptions,
              );
            }
            return this.finalizeResponse(ctx);
          } catch (error: unknown) {
            await this.handleError(ctx, error);
            return this.finalizeResponse(ctx);
          }
        })();
      }

      if (hasEnd && !ctx.isStopped()) {
        this.endPayload.durationMs = performance.now() - startTime;
        bus.emitSync(
          "request:end",
          ctx,
          this.endPayload,
          this.runtimeEmitOptions,
        );
      }
      return this.finalizeResponse(ctx);
    } catch (error: unknown) {
      return (async () => {
        await this.handleError(ctx, error);
        return this.finalizeResponse(ctx);
      })();
    }
  }

  private finalizeResponse(ctx: Context): Response {
    if (!ctx.hasResponded()) {
      ctx.json({ error: "No response was produced." }, 500);
    }
    const res = buildResponse(ctx);
    if (!(ctx.body instanceof ReadableStream)) {
      this.releaseContext(ctx);
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

  private acquireContext(server?: Server<any>): Context {
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

  private releaseContext(ctx: Context): void {
    if (this.contextPool.length < this.maxPoolSize) {
      this.contextPool.push(ctx);
    }
  }
}
