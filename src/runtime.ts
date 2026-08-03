/**
 * SinwanJS Core Runtime — Runtime Orchestrator
 *
 * Top-level composition of HTTPRouter, WSRouter, InternalAssets, EventBus,
 * and ErrorHandler. Request handling is explicit orchestration (no step engine):
 *
 *   1. InternalAssets gate (favicon/robots/block/passthrough) — optional.
 *   2. WS upgrade — intercepts the request before HTTP routing if a WS route matches.
 *   3. HTTPRouter — resolves the route and runs the handler chain.
 */

import { Context } from "./context/context";
import { buildResponse } from "./response";
import type { ErrorHandler } from "./error-handler";
import type { ErrorNormalizer } from "./error-normalizer";
import type { EventBus } from "./event-bus";
import { HTTPRouter } from "./routers/http-router";
import { WSRouter } from "./routers/ws-router";
import { InternalAssets } from "./internal-assets";
import type { Plugin } from "./types";
import type { Request } from "./types";
import type { Server } from "bun";

export interface RuntimeConfig {
  bus: EventBus;
  errorHandler: ErrorHandler;
  globalState: Map<string, unknown>;
  /** HTTP router used for HTTP request resolution. */
  httpRouter: HTTPRouter;
  /** Optional internal-assets gate that runs before WS/HTTP. */
  internalAssets?: InternalAssets;
  /** Optional WebSocket router for HTTP upgrade interception. */
  wsRouter?: WSRouter;
  maxPoolSize?: number;
}

export class Runtime {
  public readonly bus: EventBus;
  public readonly errorHandler: ErrorHandler;
  public readonly httpRouter: HTTPRouter;
  public readonly internalAssets?: InternalAssets;
  public readonly wsRouter?: WSRouter;
  private readonly globalState: Map<string, unknown>;
  private readonly contextPool: Context[] = [];
  private readonly maxPoolSize: number;

  private readonly runtimeEmitOptions = { source: "runtime" as const };

  constructor(params: RuntimeConfig) {
    this.bus = params.bus;
    this.errorHandler = params.errorHandler;
    this.globalState = params.globalState;
    this.httpRouter = params.httpRouter;
    this.internalAssets = params.internalAssets;
    this.wsRouter = params.wsRouter;
    this.maxPoolSize = params.maxPoolSize ?? 1000;
  }

  /** Shared ErrorNormalizer accessible by all protocol routers. */
  get errorNormalizer(): ErrorNormalizer {
    return this.errorHandler.normalizer;
  }

  /**
   * Install a Plugin.
   */
  use(plugin: Plugin): void {
    plugin.install(this);
  }

  /**
   * The main fetch handler for Bun.serve().
   * Creates or reuses a Context, runs the explicit request pipeline
   * (internal-assets → WS upgrade → HTTP router), and returns a Response.
   */
  fetch(req: Request, server?: Server<unknown>): Response | Promise<Response> {
    const ctx = this.acquireContext(server);
    ctx.setReq(req);

    const bus = this.bus;
    const hasEnd = bus.hasListeners("request:end");
    const startTime = hasEnd ? performance.now() : 0;
    const hasStart = bus.hasListeners("request:start");

    // Run stages 2+3 (WS upgrade + HTTP router). Stage 1 (internal assets) is
    // a synchronous gate handled by the caller before invoking this.
    const runRest = (): void | Promise<void> => {
      // 2. WS upgrade — intercepts the request before HTTP routing
      const wsRouter = this.wsRouter;
      if (wsRouter && wsRouter.hasRoutes()) {
        const ws = wsRouter.tryUpgrade(ctx, server);
        if (ws instanceof Promise) {
          return (async () => {
            if (await ws) return; // consumed by a WS route
            await this.runHttp(ctx);
          })();
        }
        if (ws) return; // consumed by a WS route
      }
      // 3. HTTP router
      return this.runHttp(ctx);
    };

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
          // 1. Internal-assets gate (sync)
          if (this.gateInternalAssets(ctx)) {
            return this.finalizeResponse(ctx, startTime);
          }
          const r = runRest();
          if (r instanceof Promise) await r;
          return this.finalizeResponse(ctx, startTime);
        } catch (error: unknown) {
          await this.handleError(ctx, error);
          return this.finalizeResponse(ctx, startTime);
        }
      })();
    }

    // No request:start listener — try a synchronous fast path.
    try {
      // 1. Internal-assets gate (sync)
      if (this.gateInternalAssets(ctx)) {
        return this.finalizeResponse(ctx, startTime);
      }
      const r = runRest();
      if (r instanceof Promise) {
        return (async () => {
          try {
            await r;
            return this.finalizeResponse(ctx, startTime);
          } catch (error: unknown) {
            await this.handleError(ctx, error);
            return this.finalizeResponse(ctx, startTime);
          }
        })();
      }
      return this.finalizeResponse(ctx, startTime);
    } catch (error: unknown) {
      return (async () => {
        await this.handleError(ctx, error);
        return this.finalizeResponse(ctx, startTime);
      })();
    }
  }

  /**
   * Stage 1: run the internal-assets gate. Returns `true` if the request was
   * consumed (handled or passthrough) and the pipeline should stop.
   */
  private gateInternalAssets(ctx: Context): boolean {
    const assets = this.internalAssets;
    if (!assets) return false;
    const result = assets.handle(ctx);
    if (result === "continue") return false;
    // "handled" (response set) or "passthrough" (stop, no response → 500)
    return true;
  }

  /**
   * Stage 3: run the HTTP router against the context.
   */
  private runHttp(ctx: Context): void | Promise<void> {
    return this.httpRouter.handle(ctx, (error) =>
      this.errorHandler.handle(error, ctx),
    );
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
          { ...this.runtimeEmitOptions, forceDelivery: true },
        );
      }
    }

    const body = ctx.body;
    // Fast path: string, null, undefined, number, boolean are never persistent
    if (body === null || typeof body !== "object") {
      ctx.dispose();
      this.releaseContext(ctx);
    } else {
      const isPersistent =
        body instanceof ReadableStream ||
        Symbol.asyncIterator in body ||
        (typeof (body as { _isSSE?: unknown })._isSSE === "boolean" &&
          (body as { _isSSE: boolean })._isSSE);

      if (!isPersistent) {
        ctx.dispose();
        this.releaseContext(ctx);
      } else {
        ctx.onDispose(() => this.releaseContext(ctx));
      }
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

  acquireContext(server?: Server<unknown>): Context {
    const ctx = this.contextPool.pop();
    if (ctx) {
      ctx.reset({
        bus: this.bus,
        server,
        errorHandler: this.errorHandler,
        global: this.globalState,
      });
      return ctx;
    }
    return new Context({
      bus: this.bus,
      server,
      errorHandler: this.errorHandler,
      global: this.globalState,
    });
  }

  releaseContext(ctx: Context): void {
    if (ctx.markReleased()) return;
    if (this.contextPool.length < this.maxPoolSize) {
      this.contextPool.push(ctx);
    }
  }
}
