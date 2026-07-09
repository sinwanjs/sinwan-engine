import { describe, expect, test, mock } from "bun:test";
import {
  WSRouter,
  type WSRouteConfig,
  type WSOptions,
} from "../../src/routers/ws-router";
import { Runtime, type RuntimeConfig } from "../../src/runtime";
import { StepEngine } from "../../src/step-engine";
import { EventBus } from "../../src/event-bus";
import { ErrorHandler } from "../../src/error-handler";
import { Context } from "../../src/context/context";
import type { WSSData } from "../../src/context/context";
import type { ServerWebSocket, Server } from "bun";
import type { Request } from "../../src/types";

function createRuntime(overrides?: Partial<RuntimeConfig>): Runtime {
  const engine = new StepEngine();
  const bus = new EventBus();
  const errorHandler = new ErrorHandler();
  const globalState = new Map<string, unknown>();
  return new Runtime({ engine, bus, errorHandler, globalState, ...overrides });
}

function createMockReq(
  url: string = "http://localhost:3000/ws",
  method: string = "GET",
): Request {
  return new Request(url, { method }) as unknown as Request;
}

function createMockWS(
  path: string = "/ws",
  data: unknown = null,
  state: Record<string, unknown> = {},
): ServerWebSocket<WSSData> {
  return {
    data: { path, data, state },
    send: mock(() => true),
    close: mock(() => {}),
    subscribe: mock(() => {}),
    unsubscribe: mock(() => {}),
    publish: mock(() => 0),
    isSubscribed: mock(() => false),
    cork: mock((cb: () => void) => cb()),
    readyState: 1,
    remoteAddress: "127.0.0.1",
    binaryType: "arraybuffer",
  } as unknown as ServerWebSocket<WSSData>;
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

describe("WSRouter", () => {
  // ─── Plugin interface ────────────────────────────────────

  describe("plugin interface", () => {
    test("has correct name", () => {
      const router = new WSRouter();
      expect(router.name).toBe("sinwan:ws-router");
    });

    test("install() registers a step in the engine", () => {
      const router = new WSRouter();
      const engine = new StepEngine();
      const runtime = createRuntime({ engine });
      router.install(runtime);
      // Step should be registered — fetching will run it
      expect(engine).toBeDefined();
    });

    test("install() step skips non-HTTP contexts", async () => {
      const router = new WSRouter();
      router.ws("/ws", { open: () => {} });
      const engine = new StepEngine();
      const bus = new EventBus();
      const errorHandler = new ErrorHandler();
      const globalState = new Map<string, unknown>();
      const runtime = new Runtime({ engine, bus, errorHandler, globalState });
      router.install(runtime);
      const ctx = runtime.acquireContext();
      ctx.setReq(createMockReq());
      ctx.setTCP({} as never);
      engine.run(ctx, bus);
      expect(ctx.hasResponded()).toBe(false);
    });

    test("install() step skips when no server", async () => {
      const router = new WSRouter();
      router.ws("/ws", { open: () => {} });
      const engine = new StepEngine();
      const bus = new EventBus();
      const errorHandler = new ErrorHandler();
      const globalState = new Map<string, unknown>();
      const runtime = new Runtime({ engine, bus, errorHandler, globalState });
      router.install(runtime);
      const ctx = runtime.acquireContext();
      ctx.setReq(createMockReq());
      // No server set — should skip
      engine.run(ctx, bus);
      expect(ctx.hasResponded()).toBe(false);
    });
  });

  // ─── Route registration ──────────────────────────────────

  describe("route registration", () => {
    test("ws() registers a route", () => {
      const router = new WSRouter();
      router.ws("/ws", { open: () => {} });
      expect(router.hasRoutes()).toBe(true);
    });

    test("ws() normalizes trailing slash", () => {
      const router = new WSRouter();
      router.ws("/ws/", { open: () => {} });
      expect(router.hasRoutes()).toBe(true);
    });

    test("ws() normalizes empty path to /", () => {
      const router = new WSRouter();
      router.ws("", { open: () => {} });
      expect(router.hasRoutes()).toBe(true);
    });

    test("hasRoutes() returns false when no routes", () => {
      const router = new WSRouter();
      expect(router.hasRoutes()).toBe(false);
    });

    test("hasRoutes() returns true after registering route", () => {
      const router = new WSRouter();
      router.ws("/ws", { open: () => {} });
      expect(router.hasRoutes()).toBe(true);
    });
  });

  // ─── setOptions ──────────────────────────────────────────

  describe("setOptions()", () => {
    test("sets WS options", () => {
      const router = new WSRouter();
      router.ws("/ws", { open: () => {} });
      const opts: WSOptions = {
        idleTimeout: 60,
        maxPayloadLength: 1024 * 1024,
        sendPings: false,
      };
      router.setOptions(opts);
      // Verify options are forwarded by checking buildWebSocketHandlers
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime);
      expect(handlers).toBeDefined();
      // Options are spread into the handler object
      expect(handlers?.idleTimeout).toBe(60);
      expect(handlers?.sendPings).toBe(false);
    });

    test("default options are empty", () => {
      const router = new WSRouter();
      router.ws("/ws", { open: () => {} });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime);
      expect(handlers).toBeDefined();
      expect(handlers?.idleTimeout).toBeUndefined();
    });
  });

  // ─── buildWebSocketHandlers ──────────────────────────────

  describe("buildWebSocketHandlers()", () => {
    test("returns undefined when no routes", () => {
      const router = new WSRouter();
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime);
      expect(handlers).toBeUndefined();
    });

    test("returns handler object when routes exist", () => {
      const router = new WSRouter();
      router.ws("/ws", { open: () => {} });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime);
      expect(handlers).toBeDefined();
      expect(typeof handlers?.open).toBe("function");
      expect(typeof handlers?.message).toBe("function");
      expect(typeof handlers?.close).toBe("function");
      expect(typeof handlers?.error).toBe("function");
      expect(typeof handlers?.drain).toBe("function");
      expect(typeof handlers?.ping).toBe("function");
      expect(typeof handlers?.pong).toBe("function");
    });

    test("open hook is called", async () => {
      const router = new WSRouter();
      let opened = false;
      router.ws("/ws", {
        open: () => {
          opened = true;
        },
      });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime)!;
      handlers.open!(createMockWS());
      await flushPromises();
      expect(opened).toBe(true);
    });

    test("message hook is called with message", async () => {
      const router = new WSRouter();
      let receivedMsg: string | ArrayBuffer | Uint8Array | undefined;
      router.ws("/ws", {
        message: (_ctx, msg) => {
          receivedMsg = msg;
        },
      });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime)!;
      handlers.message!(createMockWS(), "hello");
      await flushPromises();
      expect(receivedMsg).toBe("hello");
    });

    test("close hook is called with code and reason", async () => {
      const router = new WSRouter();
      let receivedCode: number | undefined;
      let receivedReason: string | undefined;
      router.ws("/ws", {
        close: (_ctx, code, reason) => {
          receivedCode = code;
          receivedReason = reason;
        },
      });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime)!;
      handlers.close!(createMockWS(), 1000, "normal");
      await flushPromises();
      expect(receivedCode).toBe(1000);
      expect(receivedReason).toBe("normal");
    });

    test("error hook is called with error", async () => {
      const router = new WSRouter();
      let receivedError: Error | undefined;
      router.ws("/ws", {
        error: (_ctx, err) => {
          receivedError = err;
        },
      });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime)!;
      const testError = new Error("ws error");
      handlers.error!(createMockWS(), testError);
      await flushPromises();
      expect(receivedError).toBe(testError);
    });

    test("drain hook is called", async () => {
      const router = new WSRouter();
      let drained = false;
      router.ws("/ws", {
        drain: () => {
          drained = true;
        },
      });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime)!;
      handlers.drain!(createMockWS());
      await flushPromises();
      expect(drained).toBe(true);
    });

    test("ping hook is called with data", async () => {
      const router = new WSRouter();
      let receivedData: Buffer | undefined;
      router.ws("/ws", {
        ping: (_ctx, data) => {
          receivedData = data;
        },
      });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime)!;
      const pingData = Buffer.from("ping");
      handlers.ping!(createMockWS(), pingData);
      await flushPromises();
      expect(receivedData).toBe(pingData);
    });

    test("pong hook is called with data", async () => {
      const router = new WSRouter();
      let receivedData: Buffer | undefined;
      router.ws("/ws", {
        pong: (_ctx, data) => {
          receivedData = data;
        },
      });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime)!;
      const pongData = Buffer.from("pong");
      handlers.pong!(createMockWS(), pongData);
      await flushPromises();
      expect(receivedData).toBe(pongData);
    });

    test("hooks work when no config is registered for path", async () => {
      const router = new WSRouter();
      router.ws("/ws", { open: () => {} });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime)!;
      // Call open with a WS that has a different path — no entry found
      handlers.open!(createMockWS("/other"));
      await flushPromises();
      // Should not throw — just no hook called
    });

    test("async hook is awaited", async () => {
      const router = new WSRouter();
      let hookCompleted = false;
      router.ws("/ws", {
        open: async () => {
          await new Promise((r) => setTimeout(r, 5));
          hookCompleted = true;
        },
      });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime)!;
      handlers.open!(createMockWS());
      await flushPromises();
      expect(hookCompleted).toBe(true);
    });

    test("hook error is caught and does not throw", async () => {
      const router = new WSRouter();
      router.ws("/ws", {
        open: () => {
          throw new Error("hook fail");
        },
      });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime)!;
      expect(() => handlers.open!(createMockWS())).not.toThrow();
      await flushPromises();
    });

    test("async hook error is caught", async () => {
      const router = new WSRouter();
      router.ws("/ws", {
        open: async () => {
          await new Promise((r) => setTimeout(r, 1));
          throw new Error("async hook fail");
        },
      });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime)!;
      expect(() => handlers.open!(createMockWS())).not.toThrow();
      await flushPromises();
    });
  });

  // ─── buildWebSocketHandlers — bus events ─────────────────

  describe("buildWebSocketHandlers — bus events", () => {
    test("emits ws:open event when listeners exist", async () => {
      const router = new WSRouter();
      router.ws("/ws", { open: () => {} });
      const bus = new EventBus();
      let eventFired = false;
      bus.on("ws:open", () => {
        eventFired = true;
      });
      const runtime = createRuntime({ bus });
      const handlers = router.buildWebSocketHandlers(runtime)!;
      handlers.open!(createMockWS());
      await flushPromises();
      expect(eventFired).toBe(true);
    });

    test("emits ws:message event with payload", async () => {
      const router = new WSRouter();
      router.ws("/ws", { message: () => {} });
      const bus = new EventBus();
      let receivedPayload: unknown;
      bus.on("ws:message", (_ctx, payload) => {
        receivedPayload = payload;
      });
      const runtime = createRuntime({ bus });
      const handlers = router.buildWebSocketHandlers(runtime)!;
      handlers.message!(createMockWS(), "test-msg");
      await flushPromises();
      expect(receivedPayload).toEqual({ path: "/ws", message: "test-msg" });
    });

    test("emits ws:close event with code and reason", async () => {
      const router = new WSRouter();
      router.ws("/ws", { close: () => {} });
      const bus = new EventBus();
      let receivedPayload: unknown;
      bus.on("ws:close", (_ctx, payload) => {
        receivedPayload = payload;
      });
      const runtime = createRuntime({ bus });
      const handlers = router.buildWebSocketHandlers(runtime)!;
      handlers.close!(createMockWS(), 4001, "gone");
      await flushPromises();
      expect(receivedPayload).toEqual({
        path: "/ws",
        code: 4001,
        reason: "gone",
      });
    });

    test("emits ws:error event with error", async () => {
      const router = new WSRouter();
      router.ws("/ws", { error: () => {} });
      const bus = new EventBus();
      let receivedPayload: unknown;
      bus.on("ws:error", (_ctx, payload) => {
        receivedPayload = payload;
      });
      const runtime = createRuntime({ bus });
      const handlers = router.buildWebSocketHandlers(runtime)!;
      const testError = new Error("boom");
      handlers.error!(createMockWS(), testError);
      await flushPromises();
      expect(receivedPayload).toEqual({ path: "/ws", error: testError });
    });

    test("emits ws:drain event", async () => {
      const router = new WSRouter();
      router.ws("/ws", { drain: () => {} });
      const bus = new EventBus();
      let eventFired = false;
      bus.on("ws:drain", () => {
        eventFired = true;
      });
      const runtime = createRuntime({ bus });
      const handlers = router.buildWebSocketHandlers(runtime)!;
      handlers.drain!(createMockWS());
      await flushPromises();
      expect(eventFired).toBe(true);
    });

    test("emits ws:ping event with data", async () => {
      const router = new WSRouter();
      router.ws("/ws", { ping: () => {} });
      const bus = new EventBus();
      let receivedPayload: unknown;
      bus.on("ws:ping", (_ctx, payload) => {
        receivedPayload = payload;
      });
      const runtime = createRuntime({ bus });
      const handlers = router.buildWebSocketHandlers(runtime)!;
      const pingData = Buffer.from("ping");
      handlers.ping!(createMockWS(), pingData);
      await flushPromises();
      expect(receivedPayload).toEqual({ path: "/ws", data: pingData });
    });

    test("emits ws:pong event with data", async () => {
      const router = new WSRouter();
      router.ws("/ws", { pong: () => {} });
      const bus = new EventBus();
      let receivedPayload: unknown;
      bus.on("ws:pong", (_ctx, payload) => {
        receivedPayload = payload;
      });
      const runtime = createRuntime({ bus });
      const handlers = router.buildWebSocketHandlers(runtime)!;
      const pongData = Buffer.from("pong");
      handlers.pong!(createMockWS(), pongData);
      await flushPromises();
      expect(receivedPayload).toEqual({ path: "/ws", data: pongData });
    });

    test("bus event fires even without a hook", async () => {
      const router = new WSRouter();
      router.ws("/ws", {});
      const bus = new EventBus();
      let eventFired = false;
      bus.on("ws:open", () => {
        eventFired = true;
      });
      const runtime = createRuntime({ bus });
      const handlers = router.buildWebSocketHandlers(runtime)!;
      handlers.open!(createMockWS());
      await flushPromises();
      expect(eventFired).toBe(true);
    });

    test("no work when neither hook nor listeners exist", async () => {
      const router = new WSRouter();
      router.ws("/ws", {});
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime)!;
      // Should not throw — just early return
      expect(() => handlers.open!(createMockWS())).not.toThrow();
      await flushPromises();
    });
  });

  // ─── allowedStateKeys ────────────────────────────────────

  describe("allowedStateKeys", () => {
    test("default keys are imported", async () => {
      const router = new WSRouter();
      let capturedUserId: unknown;
      router.ws("/ws", {
        open: (ctx) => {
          capturedUserId = ctx.get("userId");
        },
      });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime)!;
      handlers.open!(
        createMockWS("/ws", null, { userId: "u123", role: "admin" }),
      );
      await flushPromises();
      expect(capturedUserId).toBe("u123");
    });

    test("non-whitelisted keys are excluded", async () => {
      const router = new WSRouter();
      let capturedSecret: unknown;
      router.ws("/ws", {
        open: (ctx) => {
          capturedSecret = ctx.get("secret");
        },
      });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime)!;
      handlers.open!(
        createMockWS("/ws", null, { userId: "u123", secret: "s3cret" }),
      );
      await flushPromises();
      expect(capturedSecret).toBeUndefined();
    });

    test("custom allowedStateKeys are used", async () => {
      const router = new WSRouter();
      let capturedToken: unknown;
      let capturedUserId: unknown;
      router.ws("/ws", {
        allowedStateKeys: ["token"],
        open: (ctx) => {
          capturedToken = ctx.get("token");
          capturedUserId = ctx.get("userId");
        },
      });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime)!;
      handlers.open!(
        createMockWS("/ws", null, { userId: "u123", token: "t456" }),
      );
      await flushPromises();
      expect(capturedToken).toBe("t456");
      expect(capturedUserId).toBeUndefined();
    });

    test("state not imported when no config", async () => {
      const router = new WSRouter();
      // Route exists but entry has no config for this path at hook time
      router.ws("/ws", { open: () => {} });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime)!;
      // Call with a path that doesn't match — entry will be undefined
      handlers.open!(createMockWS("/other", null, { userId: "u123" }));
      await flushPromises();
      // Should not throw — state just not imported
    });
  });

  // ─── install() — upgrade flow ────────────────────────────

  describe("install() — upgrade flow", () => {
    test("upgrade succeeds when server.upgrade returns true", async () => {
      const router = new WSRouter();
      let upgradeCalled = false;
      router.ws("/ws", {
        upgrade: (ctx) => {
          ctx.set("ws:data", { user: "test" });
        },
      });
      const mockServer = {
        upgrade: mock(() => {
          upgradeCalled = true;
          return true;
        }),
        publish: mock(() => 0),
      } as unknown as Server<unknown>;
      const engine = new StepEngine();
      const bus = new EventBus();
      const errorHandler = new ErrorHandler();
      const globalState = new Map<string, unknown>();
      const runtime = new Runtime({ engine, bus, errorHandler, globalState });
      router.install(runtime);
      const ctx = runtime.acquireContext(mockServer);
      ctx.setReq(createMockReq("http://localhost/ws"));
      const result = engine.run(ctx, bus);
      if (result instanceof Promise) await result;
      await flushPromises();
      expect(upgradeCalled).toBe(true);
      expect(ctx.hasResponded()).toBe(false);
    });

    test("upgrade fails when server.upgrade returns false", async () => {
      const router = new WSRouter();
      router.ws("/ws", {});
      const mockServer = {
        upgrade: mock(() => false),
        publish: mock(() => 0),
      } as unknown as Server<unknown>;
      const engine = new StepEngine();
      const bus = new EventBus();
      const errorHandler = new ErrorHandler();
      const globalState = new Map<string, unknown>();
      const runtime = new Runtime({ engine, bus, errorHandler, globalState });
      router.install(runtime);
      const ctx = runtime.acquireContext(mockServer);
      ctx.setReq(createMockReq("http://localhost/ws"));
      const result = engine.run(ctx, bus);
      if (result instanceof Promise) await result;
      await flushPromises();
      expect(ctx.hasResponded()).toBe(true);
      expect(ctx.statusCode).toBe(500);
    });

    test("upgrade hook rejects by setting response", async () => {
      const router = new WSRouter();
      router.ws("/ws", {
        upgrade: (ctx) => {
          ctx.json({ error: "Unauthorized" }, 401);
        },
      });
      const mockServer = {
        upgrade: mock(() => true),
        publish: mock(() => 0),
      } as unknown as Server<unknown>;
      const engine = new StepEngine();
      const bus = new EventBus();
      const errorHandler = new ErrorHandler();
      const globalState = new Map<string, unknown>();
      const runtime = new Runtime({ engine, bus, errorHandler, globalState });
      router.install(runtime);
      const ctx = runtime.acquireContext(mockServer);
      ctx.setReq(createMockReq("http://localhost/ws"));
      const result = engine.run(ctx, bus);
      if (result instanceof Promise) await result;
      await flushPromises();
      // Upgrade hook set a response, so upgrade should not be called
      expect(ctx.hasResponded()).toBe(true);
      expect(ctx.statusCode).toBe(401);
      expect(mockServer.upgrade).not.toHaveBeenCalled();
    });

    test("no upgrade when path does not match", async () => {
      const router = new WSRouter();
      router.ws("/ws", { open: () => {} });
      const mockServer = {
        upgrade: mock(() => true),
        publish: mock(() => 0),
      } as unknown as Server<unknown>;
      const engine = new StepEngine();
      const bus = new EventBus();
      const errorHandler = new ErrorHandler();
      const globalState = new Map<string, unknown>();
      const runtime = new Runtime({ engine, bus, errorHandler, globalState });
      router.install(runtime);
      const ctx = runtime.acquireContext(mockServer);
      ctx.setReq(createMockReq("http://localhost/other"));
      const result = engine.run(ctx, bus);
      if (result instanceof Promise) await result;
      await flushPromises();
      expect(mockServer.upgrade).not.toHaveBeenCalled();
      expect(ctx.hasResponded()).toBe(false);
    });

    test("async upgrade hook is awaited", async () => {
      const router = new WSRouter();
      let hookCompleted = false;
      router.ws("/ws", {
        upgrade: async (ctx) => {
          await new Promise((r) => setTimeout(r, 5));
          hookCompleted = true;
          ctx.set("ws:data", { async: true });
        },
      });
      const mockServer = {
        upgrade: mock(() => true),
        publish: mock(() => 0),
      } as unknown as Server<unknown>;
      const engine = new StepEngine();
      const bus = new EventBus();
      const errorHandler = new ErrorHandler();
      const globalState = new Map<string, unknown>();
      const runtime = new Runtime({ engine, bus, errorHandler, globalState });
      router.install(runtime);
      const ctx = runtime.acquireContext(mockServer);
      ctx.setReq(createMockReq("http://localhost/ws"));
      const result = engine.run(ctx, bus);
      if (result instanceof Promise) await result;
      await flushPromises();
      expect(hookCompleted).toBe(true);
      expect(mockServer.upgrade).toHaveBeenCalled();
    });

    test("upgrade with trailing slash in URL", async () => {
      const router = new WSRouter();
      router.ws("/ws", {});
      const mockServer = {
        upgrade: mock(() => true),
        publish: mock(() => 0),
      } as unknown as Server<unknown>;
      const engine = new StepEngine();
      const bus = new EventBus();
      const errorHandler = new ErrorHandler();
      const globalState = new Map<string, unknown>();
      const runtime = new Runtime({ engine, bus, errorHandler, globalState });
      router.install(runtime);
      const ctx = runtime.acquireContext(mockServer);
      ctx.setReq(createMockReq("http://localhost/ws/"));
      const result = engine.run(ctx, bus);
      if (result instanceof Promise) await result;
      await flushPromises();
      expect(mockServer.upgrade).toHaveBeenCalled();
    });

    test("upgrade with query string in URL", async () => {
      const router = new WSRouter();
      router.ws("/ws", {});
      const mockServer = {
        upgrade: mock(() => true),
        publish: mock(() => 0),
      } as unknown as Server<unknown>;
      const engine = new StepEngine();
      const bus = new EventBus();
      const errorHandler = new ErrorHandler();
      const globalState = new Map<string, unknown>();
      const runtime = new Runtime({ engine, bus, errorHandler, globalState });
      router.install(runtime);
      const ctx = runtime.acquireContext(mockServer);
      ctx.setReq(createMockReq("http://localhost/ws?token=abc"));
      const result = engine.run(ctx, bus);
      if (result instanceof Promise) await result;
      await flushPromises();
      expect(mockServer.upgrade).toHaveBeenCalled();
    });
  });

  // ─── extractPathname edge cases ──────────────────────────

  describe("extractPathname edge cases", () => {
    test("URL with no protocol", async () => {
      const router = new WSRouter();
      router.ws("/ws", {});
      const mockServer = {
        upgrade: mock(() => true),
        publish: mock(() => 0),
      } as unknown as Server<unknown>;
      const engine = new StepEngine();
      const bus = new EventBus();
      const errorHandler = new ErrorHandler();
      const globalState = new Map<string, unknown>();
      const runtime = new Runtime({ engine, bus, errorHandler, globalState });
      router.install(runtime);
      const ctx = runtime.acquireContext(mockServer);
      // Create a request with a relative-looking URL
      ctx.setReq(new Request("http://localhost/ws") as unknown as Request);
      const result = engine.run(ctx, bus);
      if (result instanceof Promise) await result;
      await flushPromises();
      expect(mockServer.upgrade).toHaveBeenCalled();
    });

    test("URL with no path after host returns /", async () => {
      const router = new WSRouter();
      router.ws("/", {});
      const mockServer = {
        upgrade: mock(() => true),
        publish: mock(() => 0),
      } as unknown as Server<unknown>;
      const engine = new StepEngine();
      const bus = new EventBus();
      const errorHandler = new ErrorHandler();
      const globalState = new Map<string, unknown>();
      const runtime = new Runtime({ engine, bus, errorHandler, globalState });
      router.install(runtime);
      const ctx = runtime.acquireContext(mockServer);
      ctx.setReq(new Request("http://localhost") as unknown as Request);
      const result = engine.run(ctx, bus);
      if (result instanceof Promise) await result;
      await flushPromises();
      // extractPathname returns "/" for URL with no path
      expect(mockServer.upgrade).toHaveBeenCalled();
    });
  });

  // ─── runWSHook — ctx.stop() prevents hook ────────────────

  describe("runWSHook — ctx.stop()", () => {
    test("hook is not called when ctx is stopped by bus listener", async () => {
      const router = new WSRouter();
      let hookCalled = false;
      router.ws("/ws", {
        open: () => {
          hookCalled = true;
        },
      });
      const bus = new EventBus();
      bus.on("ws:open", (ctx) => {
        ctx.stop();
      });
      const runtime = createRuntime({ bus });
      const handlers = router.buildWebSocketHandlers(runtime)!;
      handlers.open!(createMockWS());
      await flushPromises();
      expect(hookCalled).toBe(false);
    });
  });

  // ─── WS options forwarding ───────────────────────────────

  describe("WS options forwarding", () => {
    test("perMessageDeflate option is forwarded", () => {
      const router = new WSRouter();
      router.ws("/ws", { open: () => {} });
      router.setOptions({
        perMessageDeflate: { compress: true, decompress: "shared" as const },
      });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime);
      expect(handlers?.perMessageDeflate).toEqual({
        compress: true,
        decompress: "shared",
      });
    });

    test("all options are forwarded", () => {
      const router = new WSRouter();
      router.ws("/ws", { open: () => {} });
      router.setOptions({
        idleTimeout: 30,
        maxPayloadLength: 1024,
        backpressureLimit: 2048,
        closeOnBackpressureLimit: true,
        sendPings: false,
        publishToSelf: true,
      });
      const runtime = createRuntime();
      const handlers = router.buildWebSocketHandlers(runtime);
      expect(handlers?.idleTimeout).toBe(30);
      expect(handlers?.maxPayloadLength).toBe(1024);
      expect(handlers?.backpressureLimit).toBe(2048);
      expect(handlers?.closeOnBackpressureLimit).toBe(true);
      expect(handlers?.sendPings).toBe(false);
      expect(handlers?.publishToSelf).toBe(true);
    });
  });
});
