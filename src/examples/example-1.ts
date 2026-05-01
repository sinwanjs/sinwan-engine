/**
 * SinwanJS Core Runtime — Example Usage
 *
 * Demonstrates:
 *  1. Step registration (router, response handler)
 *  2. Event listeners (request timing, logging)
 *  3. Error handling with a custom logging hook
 *  4. Full Bun.serve() integration
 *
 * Run with: bun run src/example.ts
 */

import { Context } from "../context";
import { StepEngine } from "../step-engine";
import { EventBus } from "../event-bus";
import { ErrorHandler } from "../error-handler";
import { Runtime } from "../runtime";
import { buildResponse } from "../response";
import type { InternalEventPayloads, Step } from "../types";

// ─── Steps ────────────────────────────────────────────────

/**
 * Step 1: Pre-processing.
 * Demonstrates passing state to subsequent steps using ctx.set().
 */
const preProcessorStep: Step = {
  name: "pre-processor",
  async run(ctx) {
    // Set some custom data for the router to use
    ctx.set("greeting", "Welcome to SinwanJS with flexible Context!");

    // Context-scoped listener for this request only
    ctx.on("request:end", (scopedCtx) => {
      console.log(`[ctx] request finished for ${scopedCtx.requestId}`);
    });

    await ctx.emitAsync("app:custom", { note: "pre-processor ran" });
    // Auto-continues because no response is set and we return void
  },
};

/**
 * Step 2: Simple router.
 * Matches URL pathname and sets response accordingly.
 */
const routerStep: Step = {
  name: "router",
  async run(ctx) {
    const url = new URL(ctx.req.url);

    switch (url.pathname) {
      case "/":
        const greeting = ctx.get<string>("greeting");
        ctx.json({ message: greeting });
        // Auto-stops because ctx.json() was called
        return;

      case "/health":
        ctx.json({ status: "ok", uptime: process.uptime() });
        // Auto-stops because ctx.json() was called
        return;

      case "/error":
        // Deliberately throw to demonstrate error handling.
        // The StepEngine catches this and sends it to ErrorHandler.
        throw Object.assign(new Error("Something went wrong"), {
          statusCode: 503,
        });

      default:
        // Auto-continues to next step (404 handler)
        return;
    }
  },
};

/**
 * Step 3: Fallback 404 handler.
 * Only reached if the router didn't match any route.
 */
const notFoundStep: Step = {
  name: "not-found",
  async run(ctx) {
    ctx.json({ error: "Not Found" }, 404);
    // Auto-stops because ctx.json() was called
  },
};

// ─── Event Listeners ──────────────────────────────────────

function setupEventListeners(bus: EventBus): void {
  // Log every incoming request
  bus.on("request:start", (ctx) => {
    const url = new URL(ctx.req.url);
    ctx.set("requestStartTime", performance.now());
    console.log(`→ ${ctx.req.method} ${url.pathname}`);
  });

  // Wildcard listener for all request lifecycle events
  bus.on("request:*", (_ctx, _payload, meta) => {
    if (!meta) return;
    console.log(`[event] ${meta.event} via ${meta.name}`);
  });

  // Log request completion with timing
  bus.on("request:end", (ctx) => {
    const startTime = ctx.get<number>("requestStartTime");
    const duration =
      startTime !== undefined
        ? `${(performance.now() - startTime).toFixed(2)}ms`
        : "unknown";
    console.log(`← ${ctx.statusCode} [${duration}]`);
  });

  // Log errors
  bus.on("error", (_ctx, payload) => {
    console.error("✗ Error event:", payload);
  });

  // Observe when responses are committed
  bus.on("response:set", (ctx, payload) => {
    const response = payload as
      | InternalEventPayloads["response:set"]
      | undefined;
    console.log(
      `[response] ${ctx.statusCode} (${response?.kind ?? "unknown"})`,
    );
  });

  // Custom app event emitted from ctx.emit()
  bus.on("app:custom", (_ctx, payload) => {
    console.log("[custom]", payload);
  });
}

// ─── Bootstrap ────────────────────────────────────────────

function createRuntime(): Runtime {
  const engine = new StepEngine();
  engine.add(preProcessorStep);
  engine.add(routerStep);
  engine.add(notFoundStep);

  const bus = new EventBus();
  setupEventListeners(bus);

  const errorHandler = new ErrorHandler({
    onError(error) {
      // Custom logging hook — in production this could be Sentry, etc.
      console.error("[ErrorHandler Hook]", error);
    },
  });

  return new Runtime({ engine, bus, errorHandler });
}

// ─── Server ───────────────────────────────────────────────

const runtime = createRuntime();

const server = Bun.serve({
  port: 3000,
  async fetch(req: Request): Promise<Response> {
    const ctx = new Context(req);
    await runtime.execute(ctx);
    return buildResponse(ctx);
  },
});

console.log(`🚀 SinwanJS engine running at http://localhost:${server.port}`);
console.log(
  "   Try: GET /  |  GET /health  |  GET /error  |  GET /anything-else",
);
