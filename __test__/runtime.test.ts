import { describe, expect, test, mock } from "bun:test";
import { Runtime, type RuntimeConfig } from "../src/runtime";
import { EventBus } from "../src/event-bus";
import { ErrorHandler } from "../src/error-handler";
import { HTTPRouter } from "../src/routers/http-router";
import { WSRouter } from "../src/routers/ws-router";
import { Context } from "../src/context/context";
import type { Plugin, Request } from "../src/types";

function createRuntime(overrides?: Partial<RuntimeConfig>): Runtime {
  const bus = new EventBus();
  const errorHandler = new ErrorHandler();
  const globalState = new Map<string, unknown>();
  const httpRouter = new HTTPRouter();
  return new Runtime({
    bus,
    errorHandler,
    globalState,
    httpRouter,
    ...overrides,
  });
}

function createMockReq(
  url: string = "http://localhost:3000/",
  method: string = "GET",
): Request {
  return new Request(url, { method }) as unknown as Request;
}

function createMockServer(upgradeResult: boolean = true): Bun.Server<unknown> {
  return {
    upgrade: mock(() => upgradeResult),
    publish: mock(() => 0),
  } as unknown as Bun.Server<unknown>;
}

describe("Runtime", () => {
  // ─── Constructor ─────────────────────────────────────────

  describe("constructor", () => {
    test("creates instance with all config", () => {
      const rt = createRuntime();
      expect(rt).toBeInstanceOf(Runtime);
      expect(rt.bus).toBeInstanceOf(EventBus);
      expect(rt.errorHandler).toBeInstanceOf(ErrorHandler);
      expect(rt.httpRouter).toBeInstanceOf(HTTPRouter);
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
    test("returns Response for sync route that sets body", async () => {
      const rt = createRuntime();
      rt.httpRouter.get("/", (ctx) => {
        ctx.json({ hello: "world" });
      });
      const res = rt.fetch(createMockReq());
      expect(res).toBeInstanceOf(Response);
      const json = await (res as Response).json();
      expect(json).toEqual({ hello: "world" });
    });

    test("returns 404 when no route matches", async () => {
      const rt = createRuntime();
      // No route registered -> auto 404 from HTTPRouter.handle()
      const res = rt.fetch(createMockReq());
      expect(res).toBeInstanceOf(Response);
      expect((res as Response).status).toBe(404);
      const json = await (res as Response).json();
      expect(json).toEqual({ error: "Not Found", path: "/" });
    });

    test("handles sync error from a route handler", async () => {
      const rt = createRuntime();
      rt.httpRouter.get("/", () => {
        throw new Error("sync fail");
      });
      const res = rt.fetch(createMockReq());
      expect(res).toBeInstanceOf(Promise);
      const response = await res;
      expect(response.status).toBe(500);
    });
  });

  // ─── fetch() — async path ────────────────────────────────

  describe("fetch() — async path", () => {
    test("returns Response for async route handler", async () => {
      const rt = createRuntime();
      rt.httpRouter.get("/", async (ctx) => {
        await new Promise((r) => setTimeout(r, 1));
        ctx.json({ async: true });
      });
      const res = rt.fetch(createMockReq());
      expect(res).toBeInstanceOf(Promise);
      const response = await res;
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual({ async: true });
    });

    test("handles async error from route handler", async () => {
      const rt = createRuntime();
      rt.httpRouter.get("/", async () => {
        await new Promise((r) => setTimeout(r, 1));
        throw new Error("async fail");
      });
      const res = await rt.fetch(createMockReq());
      expect(res.status).toBe(500);
    });
  });

  // ─── fetch() — with request:start listener ───────────────

  describe("fetch() — with request:start listener", () => {
    test("emits request:start before running the route", async () => {
      const rt = createRuntime();
      rt.httpRouter.get("/test", (ctx) => {
        ctx.json({ ok: true });
      });
      const bus = rt.bus;
      let startPayload: { method: string; url: string } | undefined;
      bus.on("request:start", (_ctx, payload) => {
        startPayload = payload as { method: string; url: string };
      });
      await rt.fetch(createMockReq("http://localhost/test", "POST"));
      expect(startPayload).toEqual({
        method: "POST",
        url: "http://localhost/test",
      });
    });

    test("stops when request:start returns STOP", async () => {
      const rt = createRuntime();
      let routeRan = false;
      rt.httpRouter.get("/", () => {
        routeRan = true;
      });
      rt.bus.on("request:start", () => "STOP" as const);
      const res = await rt.fetch(createMockReq());
      expect(routeRan).toBe(false);
      // No response was set, so finalizeResponse gives 500
      expect(res.status).toBe(500);
    });

    test("stops when request:start calls ctx.stop()", async () => {
      const rt = createRuntime();
      let routeRan = false;
      rt.httpRouter.get("/", () => {
        routeRan = true;
      });
      rt.bus.on("request:start", (ctx) => {
        ctx.stop();
      });
      const res = await rt.fetch(createMockReq());
      expect(routeRan).toBe(false);
      expect(res.status).toBe(500);
    });

    test("handles error in request:start path", async () => {
      const rt = createRuntime();
      rt.httpRouter.get("/", (ctx) => {
        ctx.json({ ok: true });
      });
      rt.bus.on("request:start", () => {
        throw new Error("start fail");
      });
      const res = await rt.fetch(createMockReq());
      expect(res.status).toBe(500);
    });
  });

  // ─── fetch() — with request:end listener ─────────────────

  describe("fetch() — with request:end listener", () => {
    test("emits request:end with durationMs", async () => {
      const rt = createRuntime();
      rt.httpRouter.get("/", (ctx) => {
        ctx.json({ ok: true });
      });
      let endPayload: { durationMs: number } | undefined;
      rt.bus.on("request:end", (_ctx, payload) => {
        endPayload = payload as { durationMs: number };
      });
      await rt.fetch(createMockReq());
      expect(endPayload).toBeDefined();
      expect(typeof endPayload!.durationMs).toBe("number");
    });

    test("does not emit request:end when no listeners", async () => {
      const rt = createRuntime();
      rt.httpRouter.get("/", (ctx) => {
        ctx.json({ ok: true });
      });
      // Should not throw — just no event emitted
      const res = await rt.fetch(createMockReq());
      expect(res.status).toBe(200);
    });
  });

  // ─── fetch() — with request:error listener ───────────────

  describe("fetch() — with request:error listener", () => {
    test("emits request:error on route handler error", async () => {
      const rt = createRuntime();
      rt.httpRouter.get("/", () => {
        throw new Error("route fail");
      });
      let errorPayload: { error: unknown } | undefined;
      rt.bus.on("request:error", (_ctx, payload) => {
        errorPayload = payload as { error: unknown };
      });
      await rt.fetch(createMockReq());
      expect(errorPayload).toBeDefined();
      expect((errorPayload!.error as Error).message).toBe("route fail");
    });

    test("emits error event on route handler error", async () => {
      const rt = createRuntime();
      rt.httpRouter.get("/", () => {
        throw new Error("route fail");
      });
      let receivedError: unknown;
      rt.bus.on("error", (_ctx, error) => {
        receivedError = error;
      });
      await rt.fetch(createMockReq());
      expect((receivedError as Error).message).toBe("route fail");
    });

    test("request:error listener error does not prevent response", async () => {
      const rt = createRuntime();
      rt.httpRouter.get("/", () => {
        throw new Error("route fail");
      });
      rt.bus.on("request:error", () => {
        throw new Error("listener fail");
      });
      const res = await rt.fetch(createMockReq());
      expect(res.status).toBe(500);
    });

    test("error listener error does not prevent response", async () => {
      const rt = createRuntime();
      rt.httpRouter.get("/", () => {
        throw new Error("route fail");
      });
      rt.bus.on("error", () => {
        throw new Error("listener fail");
      });
      const res = await rt.fetch(createMockReq());
      expect(res.status).toBe(500);
    });
  });

  // ─── fetch() — persistent body (stream/iterator) ─────────

  describe("fetch() — persistent body", () => {
    test("does not dispose context for ReadableStream body", async () => {
      const rt = createRuntime();
      rt.httpRouter.get("/", (ctx) => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("streamed"));
            controller.close();
          },
        });
        ctx.setRawResponse(stream);
      });
      const res = await rt.fetch(createMockReq());
      expect(res.body).toBeInstanceOf(ReadableStream);
      expect(await res.text()).toBe("streamed");
    });

    test("does not dispose context for async iterable body", async () => {
      const rt = createRuntime();
      rt.httpRouter.get("/", (ctx) => {
        async function* gen() {
          yield new TextEncoder().encode("chunk");
        }
        ctx.setRawResponse(gen());
      });
      const res = await rt.fetch(createMockReq());
      expect(await res.text()).toBe("chunk");
    });

    test("disposes context for non-persistent body (JSON)", async () => {
      const rt = createRuntime();
      rt.httpRouter.get("/", (ctx) => {
        ctx.json({ data: "test" });
      });
      const res = await rt.fetch(createMockReq());
      const json = await res.json();
      expect(json).toEqual({ data: "test" });
    });
  });

  // ─── fetch() — context pooling ───────────────────────────

  describe("fetch() — context pooling", () => {
    test("reuses context from pool across requests", async () => {
      const rt = createRuntime();
      rt.httpRouter.get("/", (ctx) => {
        ctx.json({ ok: true });
      });
      await rt.fetch(createMockReq());
      // Context should be pooled after first request
      const ctx = rt.acquireContext();
      expect(ctx).toBeInstanceOf(Context);
      rt.releaseContext(ctx);
    });
  });

  // ─── fetch() — no routes ─────────────────────────────────

  describe("fetch() — no routes", () => {
    test("returns 404 when no routes registered", async () => {
      const rt = createRuntime();
      const res = await rt.fetch(createMockReq());
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json).toEqual({ error: "Not Found", path: "/" });
    });
  });

  // ─── fetch() — WebSocket upgrade interception ────────────

  describe("fetch() — WebSocket upgrade interception", () => {
    test("WS route match consumes request (upgrade succeeds)", async () => {
      const wsRouter = new WSRouter();
      wsRouter.ws("/ws", {
        upgrade: (ctx) => {
          ctx.set("ws:data", { user: "test" });
        },
      });
      let httpCalled = false;
      const httpRouter = new HTTPRouter();
      httpRouter.get("/ws", () => {
        httpCalled = true;
      });
      const rt = createRuntime({ httpRouter, wsRouter });
      const mockServer = createMockServer(true);
      const res = await rt.fetch(
        createMockReq("http://localhost/ws", "GET"),
        mockServer,
      );
      // WS upgrade was attempted
      expect(mockServer.upgrade).toHaveBeenCalled();
      // HTTP router was NOT called (WS path consumed the request)
      expect(httpCalled).toBe(false);
      // No response was set on ctx (Bun sends 101), so finalize gives 500.
      // Bun ignores this return value when upgrade succeeds.
      expect(res.status).toBe(500);
    });

    test("WS route match with failed upgrade sets 500 response", async () => {
      const wsRouter = new WSRouter();
      wsRouter.ws("/ws", {});
      const rt = createRuntime({ wsRouter });
      const mockServer = createMockServer(false);
      const res = await rt.fetch(
        createMockReq("http://localhost/ws", "GET"),
        mockServer,
      );
      expect(mockServer.upgrade).toHaveBeenCalled();
      // tryUpgrade set a 500 response (upgrade failed)
      expect(res.status).toBe(500);
    });

    test("WS upgrade hook rejects by setting a response", async () => {
      const wsRouter = new WSRouter();
      wsRouter.ws("/ws", {
        upgrade: (ctx) => {
          ctx.json({ error: "Unauthorized" }, 401);
        },
      });
      const rt = createRuntime({ wsRouter });
      const mockServer = createMockServer(true);
      const res = await rt.fetch(
        createMockReq("http://localhost/ws", "GET"),
        mockServer,
      );
      // Upgrade hook set a 401 response, so server.upgrade is not called
      expect(mockServer.upgrade).not.toHaveBeenCalled();
      expect(res.status).toBe(401);
    });

    test("no WS route match falls through to HTTP router", async () => {
      const wsRouter = new WSRouter();
      wsRouter.ws("/ws", { open: () => {} });
      const httpRouter = new HTTPRouter();
      httpRouter.get("/api", (ctx) => ctx.json({ ok: true }));
      const rt = createRuntime({ httpRouter, wsRouter });
      const mockServer = createMockServer(true);
      const res = await rt.fetch(
        createMockReq("http://localhost/api", "GET"),
        mockServer,
      );
      // No WS route matched, so upgrade should not be called
      expect(mockServer.upgrade).not.toHaveBeenCalled();
      // HTTP router handled the request
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    test("WS upgrade works with request:start listener", async () => {
      const wsRouter = new WSRouter();
      wsRouter.ws("/ws", {
        upgrade: (ctx) => {
          ctx.set("ws:data", { id: 1 });
        },
      });
      const bus = new EventBus();
      let startFired = false;
      bus.on("request:start", () => {
        startFired = true;
      });
      const rt = createRuntime({ bus, wsRouter });
      const mockServer = createMockServer(true);
      await rt.fetch(createMockReq("http://localhost/ws", "GET"), mockServer);
      expect(startFired).toBe(true);
      expect(mockServer.upgrade).toHaveBeenCalled();
    });
  });
});
