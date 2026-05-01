/**
 * SinwanJS Core Runtime — Runtime Orchestrator
 *
 * Top-level composition of StepEngine, EventBus, and ErrorHandler.
 * The execute() method is the single entry point for processing
 * a request through the entire pipeline.
 *
 * Execution flow:
 *  1. emit("request:start")
 *  2. engine.run() — deterministic step execution
 *  3. emit("request:end")
 *  4. On error: emit("error") → errorHandler.handle()
 *  5. Finally: guarantee a response exists
 */

import { Context } from "./context";
import { buildResponse } from "./response";
import type { ErrorHandler } from "./error-handler";
import type { EventBus } from "./event-bus";
import type { StepEngine } from "./step-engine";
import type { Plugin } from "./types";

interface RuntimeParams {
  engine: StepEngine;
  bus: EventBus;
  errorHandler: ErrorHandler;
}

export class Runtime {
  public readonly engine: StepEngine;
  public readonly bus: EventBus;
  public readonly errorHandler: ErrorHandler;
  private readonly services: Map<string, unknown> = new Map();

  constructor(params: RuntimeParams) {
    this.engine = params.engine;
    this.bus = params.bus;
    this.errorHandler = params.errorHandler;
  }

  /**
   * Register an app-wide service into the Dependency Injection container.
   */
  provide(name: string, service: unknown): void {
    if (this.services.has(name)) {
      throw new Error(`Service "${name}" is already registered.`);
    }
    this.services.set(name, service);
  }

  /**
   * Install a Plugin.
   */
  use(plugin: Plugin): void {
    plugin.install(this);
  }

  /**
   * The main fetch handler for Bun.serve()
   * Automatically creates the Context, executes the pipeline, and returns a Response.
   */
  async fetch(req: Request): Promise<Response> {
    const ctx = new Context(req, this.services, { bus: this.bus });
    await this.execute(ctx);
    return buildResponse(ctx);
  }

  /**
   * Execute the full request lifecycle.
   * Guaranteed to never throw — errors are caught and
   * converted into error responses.
   */
  async execute(ctx: Context): Promise<void> {
    ctx.attachBus(this.bus);
    const startTime = Date.now();

    try {
      // Phase 1: Notify listeners that a request has started
      const startResult = await this.bus.emitAsync(
        "request:start",
        ctx,
        { method: ctx.req.method, url: ctx.req.url },
        { source: "runtime" },
      );
      if (startResult === "STOP" || ctx.isStopped()) return;

      // Phase 2: Run the deterministic step pipeline
      await this.engine.run(ctx, this.bus);

      // Phase 3: Notify listeners that request processing is complete
      if (!ctx.isStopped()) {
        const durationMs = Date.now() - startTime;
        await this.bus.emitAsync(
          "request:end",
          ctx,
          { durationMs },
          { source: "runtime" },
        );
      }
    } catch (error: unknown) {
      // Phase 4: Error recovery — notify listeners, then handle
      try {
        await this.bus.emitAsync(
          "request:error",
          ctx,
          { error },
          { source: "runtime" },
        );
      } catch {
        // Error event handlers failing must not block error handling
      }

      try {
        await this.bus.emitAsync("error", ctx, error, { source: "runtime" });
      } catch {
        // Error event handlers failing must not block error handling
      }

      await this.errorHandler.handle(error, ctx);
    } finally {
      // Phase 5: Guarantee a response is always available.
      // If nothing in the pipeline set a response, produce a
      // fallback 500 so the server never sends an empty/broken reply.
      if (!ctx.hasResponded()) {
        ctx.json(
          { error: "No response was produced by the request pipeline." },
          500,
        );
      }

      ctx.dispose();
    }
  }
}
