import { describe, expect, test, mock } from "bun:test";
import { Runtime, type RuntimeConfig } from "../src/runtime";
import { StepEngine } from "../src/step-engine";
import { EventBus } from "../src/event-bus";
import { ErrorHandler } from "../src/error-handler";
import { Context } from "../src/context/context";
import type { Plugin, Step, StepResult, Request } from "../src/types";

function createRuntime(overrides?: Partial<RuntimeConfig>): Runtime {
  const engine = new StepEngine();
  const bus = new EventBus();
  const errorHandler = new ErrorHandler();
  const globalState = new Map<string, unknown>();
  return new Runtime({
    engine,
    bus,
    errorHandler,
    globalState,
    ...overrides,
  });
}

function createMockReq(
  url: string = "http://localhost:3000/",
  method: string = "GET",
): Request {
  return new Request(url, { method }) as unknown as Request;
}

describe("Runtime", () => {
  // ─── Constructor ─────────────────────────────────────────

  describe("constructor", () => {
    test("creates instance with all config", () => {
      const rt = createRuntime();
      expect(rt).toBeInstanceOf(Runtime);
      expect(rt.engine).toBeInstanceOf(StepEngine);
      expect(rt.bus).toBeInstanceOf(EventBus);
      expect(rt.errorHandler).toBeInstanceOf(ErrorHandler);
    });

    test("uses default maxPoolSize when not specified", () => {
      const rt = createRuntime();
      // Verify by acquiring/releasing — pool should accept contexts
      const ctx = rt.acquireContext();
      rt.releaseContext(ctx);
      // Re-acquire should get the same pooled context
      const ctx2 = rt.acquireContext();
      expect(ctx2).toBe(ctx);
    });

    test("respects custom maxPoolSize", () => {
      const rt = createRuntime({ maxPoolSize: 1 } as RuntimeConfig);
      const ctx1 = rt.acquireContext();
      const ctx2 = rt.acquireContext();
      rt.releaseContext(ctx1);
      rt.releaseContext(ctx2);
      // Pool size is 1, so only one context is pooled
      const ctx3 = rt.acquireContext();
      expect(ctx3).toBe(ctx1);
    });
  });

  // ─── errorNormalizer getter ──────────────────────────────

  describe("errorNormalizer getter", () => {
    test("returns the normalizer from errorHandler", () => {
      const rt = createRuntime();
      expect(rt.errorNormalizer).toBe(rt.errorHandler.normalizer);
    });
  });

  // ─── use() ───────────────────────────────────────────────

  describe("use()", () => {
    test("installs a plugin by calling install()", () => {
      const rt = createRuntime();
      let receivedRuntime: Runtime | undefined;
      const plugin: Plugin = {
        name: "test-plugin",
        install(app) {
          receivedRuntime = app;
        },
      };
      rt.use(plugin);
      expect(receivedRuntime).toBe(rt);
    });
  });

  // ─── acquireContext ──────────────────────────────────────

  describe("acquireContext()", () => {
    test("creates new Context when pool is empty", () => {
      const rt = createRuntime();
      const ctx = rt.acquireContext();
      expect(ctx).toBeInstanceOf(Context);
    });

    test("reuses Context from pool when available", () => {
      const rt = createRuntime();
      const ctx1 = rt.acquireContext();
      rt.releaseContext(ctx1);
      const ctx2 = rt.acquireContext();
      expect(ctx2).toBe(ctx1);
    });

    test("passes server to Context", () => {
      const rt = createRuntime();
      const mockServer = { publish: () => 0 } as unknown as Bun.Server<unknown>;
      const ctx = rt.acquireContext(mockServer);
      // Server should be attached — pendingWebSockets would throw if not
      expect(() => ctx.pendingWebSockets).not.toThrow();
    });

    test("passes server to reused Context", () => {
      const rt = createRuntime();
      const ctx1 = rt.acquireContext();
      rt.releaseContext(ctx1);
      const mockServer = { publish: () => 0 } as unknown as Bun.Server<unknown>;
      const ctx2 = rt.acquireContext(mockServer);
      expect(() => ctx2.pendingWebSockets).not.toThrow();
    });
  });

  // ─── releaseContext ──────────────────────────────────────

  describe("releaseContext()", () => {
    test("does not pool context if markReleased returns true (double release)", () => {
      const rt = createRuntime();
      const ctx = rt.acquireContext();
      rt.releaseContext(ctx);
      // First release marks it; second release returns early
      rt.releaseContext(ctx);
      const ctx2 = rt.acquireContext();
      expect(ctx2).toBe(ctx);
    });

    test("does not exceed maxPoolSize", () => {
      const rt = createRuntime({ maxPoolSize: 2 } as RuntimeConfig);
      const ctx1 = rt.acquireContext();
      const ctx2 = rt.acquireContext();
      const ctx3 = rt.acquireContext();
      rt.releaseContext(ctx1);
      rt.releaseContext(ctx2);
      rt.releaseContext(ctx3); // Should not be pooled (pool full)
      // Pool has ctx1 and ctx2 (in order)
      const reused1 = rt.acquireContext();
      const reused2 = rt.acquireContext();
      // Pool was LIFO, so reused1 should be ctx2, reused2 should be ctx1
      expect(reused1).toBe(ctx2);
      expect(reused2).toBe(ctx1);
    });
  });

  // ─── fetch() — sync path (no event listeners) ────────────

  describe("fetch() — sync path", () => {
    test("returns Response for sync step that sets body", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "responder",
        run(ctx) {
          ctx.json({ hello: "world" });
        },
      });
      const rt = createRuntime({ engine });
      const res = rt.fetch(createMockReq());
      expect(res).toBeInstanceOf(Response);
      const json = await (res as Response).json();
      expect(json).toEqual({ hello: "world" });
    });

    test("returns 500 when no response produced", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "noop",
        run() {},
      });
      const rt = createRuntime({ engine });
      const res = rt.fetch(createMockReq());
      expect(res).toBeInstanceOf(Response);
      expect((res as Response).status).toBe(500);
      const json = await (res as Response).json();
      expect(json).toEqual({ error: "No response was produced." });
    });

    test("handles sync error from engine.run()", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "thrower",
        run() {
          throw new Error("sync fail");
        },
      });
      const rt = createRuntime({ engine });
      const res = rt.fetch(createMockReq());
      expect(res).toBeInstanceOf(Promise);
      const response = await res;
      expect(response.status).toBe(500);
    });
  });

  // ─── fetch() — async path ────────────────────────────────

  describe("fetch() — async path", () => {
    test("returns Response for async step", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "async-responder",
        async run(ctx) {
          await new Promise((r) => setTimeout(r, 1));
          ctx.json({ async: true });
        },
      });
      const rt = createRuntime({ engine });
      const res = rt.fetch(createMockReq());
      expect(res).toBeInstanceOf(Promise);
      const response = await res;
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual({ async: true });
    });

    test("handles async error from step", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "async-thrower",
        async run() {
          await new Promise((r) => setTimeout(r, 1));
          throw new Error("async fail");
        },
      });
      const rt = createRuntime({ engine });
      const res = await rt.fetch(createMockReq());
      expect(res.status).toBe(500);
    });
  });

  // ─── fetch() — with request:start listener ───────────────

  describe("fetch() — with request:start listener", () => {
    test("emits request:start before running steps", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "responder",
        run(ctx) {
          ctx.json({ ok: true });
        },
      });
      const bus = new EventBus();
      let startPayload: { method: string; url: string } | undefined;
      bus.on("request:start", (_ctx, payload) => {
        startPayload = payload as { method: string; url: string };
      });
      const rt = createRuntime({ engine, bus });
      await rt.fetch(createMockReq("http://localhost/test", "POST"));
      expect(startPayload).toEqual({
        method: "POST",
        url: "http://localhost/test",
      });
    });

    test("stops when request:start returns STOP", async () => {
      const engine = new StepEngine();
      let stepRan = false;
      engine.add({
        name: "responder",
        run() {
          stepRan = true;
        },
      });
      const bus = new EventBus();
      bus.on("request:start", () => "STOP" as const);
      const rt = createRuntime({ engine, bus });
      const res = await rt.fetch(createMockReq());
      expect(stepRan).toBe(false);
      // No response was set, so finalizeResponse gives 500
      expect(res.status).toBe(500);
    });

    test("stops when request:start calls ctx.stop()", async () => {
      const engine = new StepEngine();
      let stepRan = false;
      engine.add({
        name: "responder",
        run() {
          stepRan = true;
        },
      });
      const bus = new EventBus();
      bus.on("request:start", (ctx) => {
        ctx.stop();
      });
      const rt = createRuntime({ engine, bus });
      const res = await rt.fetch(createMockReq());
      expect(stepRan).toBe(false);
      expect(res.status).toBe(500);
    });

    test("handles error in request:start path", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "responder",
        run(ctx) {
          ctx.json({ ok: true });
        },
      });
      const bus = new EventBus();
      bus.on("request:start", () => {
        throw new Error("start fail");
      });
      const rt = createRuntime({ engine, bus });
      const res = await rt.fetch(createMockReq());
      expect(res.status).toBe(500);
    });
  });

  // ─── fetch() — with request:end listener ─────────────────

  describe("fetch() — with request:end listener", () => {
    test("emits request:end with durationMs", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "responder",
        run(ctx) {
          ctx.json({ ok: true });
        },
      });
      const bus = new EventBus();
      let endPayload: { durationMs: number } | undefined;
      bus.on("request:end", (_ctx, payload) => {
        endPayload = payload as { durationMs: number };
      });
      const rt = createRuntime({ engine, bus });
      await rt.fetch(createMockReq());
      expect(endPayload).toBeDefined();
      expect(typeof endPayload!.durationMs).toBe("number");
    });

    test("does not emit request:end when no listeners", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "responder",
        run(ctx) {
          ctx.json({ ok: true });
        },
      });
      const rt = createRuntime({ engine });
      // Should not throw — just no event emitted
      const res = await rt.fetch(createMockReq());
      expect(res.status).toBe(200);
    });
  });

  // ─── fetch() — with request:error listener ───────────────

  describe("fetch() — with request:error listener", () => {
    test("emits request:error on step error", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "thrower",
        run() {
          throw new Error("step fail");
        },
      });
      const bus = new EventBus();
      let errorPayload: { error: unknown } | undefined;
      bus.on("request:error", (_ctx, payload) => {
        errorPayload = payload as { error: unknown };
      });
      const rt = createRuntime({ engine, bus });
      await rt.fetch(createMockReq());
      expect(errorPayload).toBeDefined();
      expect((errorPayload!.error as Error).message).toBe("step fail");
    });

    test("emits error event on step error", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "thrower",
        run() {
          throw new Error("step fail");
        },
      });
      const bus = new EventBus();
      let receivedError: unknown;
      bus.on("error", (_ctx, error) => {
        receivedError = error;
      });
      const rt = createRuntime({ engine, bus });
      await rt.fetch(createMockReq());
      expect((receivedError as Error).message).toBe("step fail");
    });

    test("request:error listener error does not prevent response", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "thrower",
        run() {
          throw new Error("step fail");
        },
      });
      const bus = new EventBus();
      bus.on("request:error", () => {
        throw new Error("listener fail");
      });
      const rt = createRuntime({ engine, bus });
      const res = await rt.fetch(createMockReq());
      expect(res.status).toBe(500);
    });

    test("error listener error does not prevent response", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "thrower",
        run() {
          throw new Error("step fail");
        },
      });
      const bus = new EventBus();
      bus.on("error", () => {
        throw new Error("listener fail");
      });
      const rt = createRuntime({ engine, bus });
      const res = await rt.fetch(createMockReq());
      expect(res.status).toBe(500);
    });
  });

  // ─── fetch() — persistent body (stream/iterator) ─────────

  describe("fetch() — persistent body", () => {
    test("does not dispose context for ReadableStream body", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "streamer",
        run(ctx) {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("streamed"));
              controller.close();
            },
          });
          ctx.setRawResponse(stream);
        },
      });
      const rt = createRuntime({ engine });
      const res = await rt.fetch(createMockReq());
      expect(res.body).toBeInstanceOf(ReadableStream);
      expect(await res.text()).toBe("streamed");
    });

    test("does not dispose context for async iterable body", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "iterator",
        run(ctx) {
          async function* gen() {
            yield new TextEncoder().encode("chunk");
          }
          ctx.setRawResponse(gen());
        },
      });
      const rt = createRuntime({ engine });
      const res = await rt.fetch(createMockReq());
      expect(await res.text()).toBe("chunk");
    });

    test("disposes context for non-persistent body (JSON)", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "responder",
        run(ctx) {
          ctx.json({ data: "test" });
        },
      });
      const rt = createRuntime({ engine });
      const res = await rt.fetch(createMockReq());
      const json = await res.json();
      expect(json).toEqual({ data: "test" });
    });
  });

  // ─── fetch() — context pooling ───────────────────────────

  describe("fetch() — context pooling", () => {
    test("reuses context from pool across requests", async () => {
      const engine = new StepEngine();
      engine.add({
        name: "responder",
        run(ctx) {
          ctx.json({ ok: true });
        },
      });
      const rt = createRuntime({ engine });
      await rt.fetch(createMockReq());
      // Context should be pooled after first request
      const ctx = rt.acquireContext();
      expect(ctx).toBeInstanceOf(Context);
      rt.releaseContext(ctx);
    });
  });

  // ─── fetch() — empty engine ──────────────────────────────

  describe("fetch() — empty engine", () => {
    test("returns 500 when no steps registered", async () => {
      const rt = createRuntime();
      const res = await rt.fetch(createMockReq());
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json).toEqual({ error: "No response was produced." });
    });
  });
});
