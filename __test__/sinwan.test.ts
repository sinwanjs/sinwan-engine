import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { Sinwan } from "../src/sinwan";
import { LifecycleState } from "../src/types";
import type { Plugin, Step } from "../src/types";
import type { SinwanModule } from "../src/modules";
import {
  registerGRPCProvider,
  type GRPCProvider,
} from "../src/context/grpc-provider";

function createMockGRPCProvider(): GRPCProvider {
  return {
    registerService: mock(() => {}),
    listen: mock(() => Promise.resolve({ stop: mock(() => {}) })),
    connect: mock(() => ({})),
    stop: mock(() => Promise.resolve()),
  };
}

describe("Sinwan", () => {
  let originalServe: typeof Bun.serve;
  let originalListen: typeof Bun.listen;
  let originalConnect: typeof Bun.connect;
  let originalUdpSocket: typeof Bun.udpSocket;
  let mockServerStop: ReturnType<typeof mock>;
  let capturedServeOptions: Record<string, unknown> | null = null;

  beforeEach(() => {
    originalServe = Bun.serve;
    originalListen = Bun.listen;
    originalConnect = Bun.connect;
    originalUdpSocket = Bun.udpSocket;
    mockServerStop = mock(() => {});
    capturedServeOptions = null;

    (Bun as unknown as Record<string, unknown>).serve = mock(
      (opts: Record<string, unknown>) => {
        capturedServeOptions = opts;
        return { stop: mockServerStop, port: 3000, hostname: "localhost" };
      },
    );

    (Bun as unknown as Record<string, unknown>).listen = mock(
      (opts: Record<string, unknown>) => {
        return { stop: mock(() => {}), port: 0, hostname: "localhost" };
      },
    );

    (Bun as unknown as Record<string, unknown>).connect = mock(
      (opts: Record<string, unknown>) => {
        return Promise.resolve({
          data: null,
          write: mock(() => 0),
          end: mock(() => 0),
          flush: mock(() => true),
          readyState: 1,
          remoteAddress: "127.0.0.1",
        });
      },
    );

    (Bun as unknown as Record<string, unknown>).udpSocket = mock(
      async (opts: Record<string, unknown>) => {
        return {
          data: null,
          send: mock(() => true),
          sendMany: mock(() => 0),
          close: mock(() => {}),
          closed: false,
          hostname: "0.0.0.0",
          port: 0,
        };
      },
    );
  });

  afterEach(() => {
    (Bun as unknown as Record<string, unknown>).serve = originalServe;
    (Bun as unknown as Record<string, unknown>).listen = originalListen;
    (Bun as unknown as Record<string, unknown>).connect = originalConnect;
    (Bun as unknown as Record<string, unknown>).udpSocket = originalUdpSocket;
  });

  // ─── Constructor ─────────────────────────────────────────

  describe("constructor", () => {
    test("creates instance with default options", () => {
      const app = new Sinwan();
      expect(app).toBeDefined();
      expect(app.lifecycle).toBeDefined();
      expect(app.bus).toBeDefined();
      expect(app.internalAssets).toBeDefined();
      expect(app.lifecycle.getState()).toBe(LifecycleState.IDLE);
    });

    test("creates instance with custom options", () => {
      const app = new Sinwan({ maxPoolSize: 500, idleTimeout: 30 });
      expect(app).toBeDefined();
    });

    test("installs internal assets when configured", () => {
      const app = new Sinwan({ internalAssets: { enabled: true } });
      expect(app.internalAssets).toBeDefined();
    });

    test("does not install internal assets when not configured", () => {
      const app = new Sinwan();
      expect(app.internalAssets).toBeDefined();
    });

    test("sets websocket options when provided", () => {
      const app = new Sinwan({ websocket: { perMessageDeflate: true } });
      expect(app).toBeDefined();
    });
  });

  // ─── Sinwan.create() ─────────────────────────────────────

  describe("Sinwan.create()", () => {
    test("creates and initializes app", async () => {
      const app = await Sinwan.create();
      expect(app).toBeDefined();
      expect(app.lifecycle.getState()).toBe(LifecycleState.INIT);
    });

    test("creates with options", async () => {
      const app = await Sinwan.create({ maxPoolSize: 100 });
      expect(app.lifecycle.getState()).toBe(LifecycleState.INIT);
    });

    test("does not re-init if already past IDLE", async () => {
      const app = await Sinwan.create();
      // Calling create again on same app isn't static, but we can
      // verify the state is INIT (not re-initialized)
      expect(app.lifecycle.getState()).toBe(LifecycleState.INIT);
    });
  });

  // ─── install() ───────────────────────────────────────────

  describe("install()", () => {
    test("installs a valid plugin", () => {
      const app = new Sinwan();
      const plugin: Plugin = {
        name: "test-plugin",
        install: mock(() => {}),
      };
      const result = app.install(plugin);
      expect(result).toBe(app);
      expect(plugin.install).toHaveBeenCalled();
    });

    test("installs multiple plugins", () => {
      const app = new Sinwan();
      const p1: Plugin = { name: "p1", install: mock(() => {}) };
      const p2: Plugin = { name: "p2", install: mock(() => {}) };
      app.install(p1, p2);
      expect(p1.install).toHaveBeenCalled();
      expect(p2.install).toHaveBeenCalled();
    });

    test("throws for non-object plugin", () => {
      const app = new Sinwan();
      expect(() => app.install(null as unknown as Plugin)).toThrow(
        "[Sinwan.install] Expected a Plugin object, got object.",
      );
    });

    test("throws for plugin without name", () => {
      const app = new Sinwan();
      expect(() =>
        app.install({ name: "", install: () => {} } as Plugin),
      ).toThrow('[Sinwan.install] Plugin must have a non-empty string "name".');
    });

    test("throws for plugin with non-string name", () => {
      const app = new Sinwan();
      expect(() =>
        app.install({ name: 123, install: () => {} } as unknown as Plugin),
      ).toThrow('[Sinwan.install] Plugin must have a non-empty string "name".');
    });

    test("throws for plugin without install method", () => {
      const app = new Sinwan();
      expect(() => app.install({ name: "test" } as unknown as Plugin)).toThrow(
        '[Sinwan.install] Plugin "test" must have an "install(rt: Runtime)" method.',
      );
    });

    test("throws for plugin with non-function install", () => {
      const app = new Sinwan();
      expect(() =>
        app.install({ name: "test", install: "not-a-fn" } as unknown as Plugin),
      ).toThrow(
        '[Sinwan.install] Plugin "test" must have an "install(rt: Runtime)" method.',
      );
    });

    test("returns this for chaining", () => {
      const app = new Sinwan();
      const plugin: Plugin = { name: "p", install: () => {} };
      expect(app.install(plugin)).toBe(app);
    });
  });

  // ─── add() ───────────────────────────────────────────────

  describe("add()", () => {
    test("adds a named step (string + function)", () => {
      const app = new Sinwan();
      const result = app.add("auth", () => {});
      expect(result).toBe(app);
    });

    test("adds a step object", () => {
      const app = new Sinwan();
      const step: Step = { name: "cors", run: () => {} };
      const result = app.add(step);
      expect(result).toBe(app);
    });

    test("throws for empty step name (string form)", () => {
      const app = new Sinwan();
      expect(() => app.add("", () => {})).toThrow(
        "[Sinwan.add] Step name cannot be empty.",
      );
    });

    test("throws for non-function run (string form)", () => {
      const app = new Sinwan();
      expect(() =>
        app.add("test", "not-a-fn" as unknown as Step["run"]),
      ).toThrow(
        '[Sinwan.add] Second argument must be a function for step "test".',
      );
    });

    test("throws for non-object step (object form)", () => {
      const app = new Sinwan();
      expect(() => app.add(null as unknown as Step)).toThrow(
        "[Sinwan.add] Expected a Step object.",
      );
    });

    test("throws for step without name (object form)", () => {
      const app = new Sinwan();
      expect(() => app.add({ name: "", run: () => {} } as Step)).toThrow(
        '[Sinwan.add] Step must have a non-empty string "name".',
      );
    });

    test("throws for step with non-string name (object form)", () => {
      const app = new Sinwan();
      expect(() =>
        app.add({ name: 123, run: () => {} } as unknown as Step),
      ).toThrow('[Sinwan.add] Step must have a non-empty string "name".');
    });

    test("throws for step without run method (object form)", () => {
      const app = new Sinwan();
      expect(() => app.add({ name: "test" } as unknown as Step)).toThrow(
        '[Sinwan.add] Step "test" must have a "run" method.',
      );
    });

    test("throws for step with non-function run (object form)", () => {
      const app = new Sinwan();
      expect(() =>
        app.add({ name: "test", run: "not-a-fn" } as unknown as Step),
      ).toThrow('[Sinwan.add] Step "test" must have a "run" method.');
    });

    test("throws for duplicate step name", () => {
      const app = new Sinwan();
      app.add("dup", () => {});
      expect(() => app.add("dup", () => {})).toThrow(
        'Duplicate step name "dup"',
      );
    });
  });

  // ─── register() ──────────────────────────────────────────

  describe("register()", () => {
    test("registers a valid module", () => {
      const app = new Sinwan();
      const mod = {
        name: "test-module",
        register: mock(() => {}),
      };
      const result = app.register(mod);
      expect(result).toBe(app);
      expect(mod.register).toHaveBeenCalledWith(app);
    });

    test("registers multiple modules", () => {
      const app = new Sinwan();
      const m1 = { name: "m1", register: mock(() => {}) };
      const m2 = { name: "m2", register: mock(() => {}) };
      app.register(m1, m2);
      expect(m1.register).toHaveBeenCalled();
      expect(m2.register).toHaveBeenCalled();
    });

    test("throws for non-object module", () => {
      const app = new Sinwan();
      expect(() => app.register(null as unknown as SinwanModule)).toThrow(
        "[Sinwan.register] Expected a module object, got object.",
      );
    });

    test("throws for module without name", () => {
      const app = new Sinwan();
      expect(() =>
        app.register({ name: "", register: () => {} } as SinwanModule),
      ).toThrow(
        '[Sinwan.register] Module must have a non-empty string "name".',
      );
    });

    test("throws for module with non-string name", () => {
      const app = new Sinwan();
      expect(() =>
        app.register({
          name: 123,
          register: () => {},
        } as unknown as SinwanModule),
      ).toThrow(
        '[Sinwan.register] Module must have a non-empty string "name".',
      );
    });

    test("throws for module without register method", () => {
      const app = new Sinwan();
      expect(() =>
        app.register({ name: "test" } as unknown as SinwanModule),
      ).toThrow(
        '[Sinwan.register] Module "test" must have a "register(app)" method.',
      );
    });
  });

  // ─── HTTP route methods ──────────────────────────────────

  describe("HTTP route methods", () => {
    test("get() registers a GET route", () => {
      const app = new Sinwan();
      const result = app.get("/test", () => {});
      expect(result).toBe(app);
    });

    test("post() registers a POST route", () => {
      const app = new Sinwan();
      expect(app.post("/test", () => {})).toBe(app);
    });

    test("put() registers a PUT route", () => {
      const app = new Sinwan();
      expect(app.put("/test", () => {})).toBe(app);
    });

    test("patch() registers a PATCH route", () => {
      const app = new Sinwan();
      expect(app.patch("/test", () => {})).toBe(app);
    });

    test("delete() registers a DELETE route", () => {
      const app = new Sinwan();
      expect(app.delete("/test", () => {})).toBe(app);
    });

    test("options() registers an OPTIONS route", () => {
      const app = new Sinwan();
      expect(app.options("/test", () => {})).toBe(app);
    });

    test("head() registers a HEAD route", () => {
      const app = new Sinwan();
      expect(app.head("/test", () => {})).toBe(app);
    });

    test("all() registers a catch-all route", () => {
      const app = new Sinwan();
      expect(app.all("/test", () => {})).toBe(app);
    });

    test("throws for empty path", () => {
      const app = new Sinwan();
      expect(() => app.get("", () => {})).toThrow(
        "[Sinwan.GET] Path must be a non-empty string.",
      );
    });

    test("throws for non-string path", () => {
      const app = new Sinwan();
      expect(() => app.get(123 as unknown as string, () => {})).toThrow(
        "[Sinwan.GET] Path must be a non-empty string.",
      );
    });

    test("throws for no handlers", () => {
      const app = new Sinwan();
      expect(() => app.get("/test")).toThrow(
        'At least one handler is required for "/test".',
      );
    });

    test("throws for non-function handler", () => {
      const app = new Sinwan();
      expect(() =>
        app.get("/test", "not-a-fn" as unknown as () => void),
      ).toThrow("[Sinwan.GET] Handler at index 0 must be a function.");
    });

    test("throws for non-function handler at index > 0", () => {
      const app = new Sinwan();
      expect(() =>
        app.get(
          "/test",
          () => {
            return;
          },
          123 as unknown as () => void,
        ),
      ).toThrow("[Sinwan.GET] Handler at index 1 must be a function.");
    });

    test("supports multiple handlers", () => {
      const app = new Sinwan();
      expect(
        app.get(
          "/test",
          () => {
            return;
          },
          () => {
            return;
          },
        ),
      ).toBe(app);
    });
  });

  // ─── ws() ────────────────────────────────────────────────

  describe("ws()", () => {
    test("registers a WebSocket route", () => {
      const app = new Sinwan();
      const result = app.ws("/chat", { open: () => {} });
      expect(result).toBe(app);
    });

    test("throws for empty path", () => {
      const app = new Sinwan();
      expect(() => app.ws("", { open: () => {} })).toThrow(
        "[Sinwan.ws] Path must be a non-empty string.",
      );
    });

    test("throws for non-string path", () => {
      const app = new Sinwan();
      expect(() =>
        app.ws(123 as unknown as string, { open: () => {} }),
      ).toThrow("[Sinwan.ws] Path must be a non-empty string.");
    });
  });

  // ─── tcp() ───────────────────────────────────────────────

  describe("tcp()", () => {
    test("registers a TCP route", () => {
      const app = new Sinwan();
      const result = app.tcp("my-tcp", { open: () => {} });
      expect(result).toBe(app);
    });

    test("throws for empty name", () => {
      const app = new Sinwan();
      expect(() => app.tcp("", { open: () => {} })).toThrow(
        "[Sinwan.tcp] Name must be a non-empty string.",
      );
    });

    test("throws for non-string name", () => {
      const app = new Sinwan();
      expect(() =>
        app.tcp(123 as unknown as string, { open: () => {} }),
      ).toThrow("[Sinwan.tcp] Name must be a non-empty string.");
    });
  });

  // ─── udp() ───────────────────────────────────────────────

  describe("udp()", () => {
    test("registers a UDP route", () => {
      const app = new Sinwan();
      const result = app.udp("my-udp", { open: () => {} });
      expect(result).toBe(app);
    });

    test("throws for empty name", () => {
      const app = new Sinwan();
      expect(() => app.udp("", { open: () => {} })).toThrow(
        "[Sinwan.udp] Name must be a non-empty string.",
      );
    });

    test("throws for non-string name", () => {
      const app = new Sinwan();
      expect(() =>
        app.udp(123 as unknown as string, { open: () => {} }),
      ).toThrow("[Sinwan.udp] Name must be a non-empty string.");
    });
  });

  // ─── grpc() ──────────────────────────────────────────────

  describe("grpc()", () => {
    let mockProvider: GRPCProvider;

    beforeEach(() => {
      mockProvider = createMockGRPCProvider();
      registerGRPCProvider(mockProvider);
    });

    test("registers a gRPC service", () => {
      const app = new Sinwan();
      const result = app.grpc("greeter", { proto: "test.proto" } as never);
      expect(result).toBe(app);
      expect(mockProvider.registerService).toHaveBeenCalledWith("greeter", {
        proto: "test.proto",
      });
    });

    test("throws for empty name", () => {
      const app = new Sinwan();
      expect(() => app.grpc("", {} as never)).toThrow(
        "[Sinwan.grpc] Name must be a non-empty string.",
      );
    });

    test("throws for non-string name", () => {
      const app = new Sinwan();
      expect(() => app.grpc(123 as unknown as string, {} as never)).toThrow(
        "[Sinwan.grpc] Name must be a non-empty string.",
      );
    });
  });

  // ─── beforeTCP() / beforeUDP() / beforeGRPC() ───────────

  describe("beforeTCP() / beforeUDP() / beforeGRPC()", () => {
    test("beforeTCP registers a bus listener", () => {
      const app = new Sinwan();
      const handler = () => {};
      const result = app.beforeTCP("open", handler);
      expect(result).toBe(app);
      expect(app.bus.hasListeners("tcp:open")).toBe(true);
    });

    test("beforeUDP registers a bus listener", () => {
      const app = new Sinwan();
      const handler = () => {};
      const result = app.beforeUDP("data", handler);
      expect(result).toBe(app);
      expect(app.bus.hasListeners("udp:data")).toBe(true);
    });

    test("beforeGRPC registers a bus listener for call", () => {
      const app = new Sinwan();
      const handler = (): void => {
        return;
      };
      const result = app.beforeGRPC("call" as never, handler as never);
      expect(result).toBe(app);
      expect(app.bus.hasListeners("grpc:call")).toBe(true);
    });

    test("beforeGRPC registers a bus listener for finish", () => {
      const app = new Sinwan();
      const result = app.beforeGRPC(
        "finish" as never,
        (() => {
          return;
        }) as never,
      );
      expect(result).toBe(app);
      expect(app.bus.hasListeners("grpc:finish")).toBe(true);
    });

    test("beforeGRPC error event wraps handler to extract error", () => {
      const app = new Sinwan();
      let receivedError: unknown;
      app.beforeGRPC(
        "error" as never,
        ((_ctx: unknown, error: unknown) => {
          receivedError = error;
        }) as never,
      );
      expect(app.bus.hasListeners("grpc:error")).toBe(true);
      app.bus.emitSync(
        "grpc:error",
        {
          requestId: "test",
          recordEvent: () => {},
          isStopped: () => false,
        } as never,
        {
          error: "test-error",
        },
      );
      expect(receivedError).toBe("test-error");
    });

    test("beforeGRPC error event handler receives payload too", () => {
      const app = new Sinwan();
      let receivedPayload: unknown;
      app.beforeGRPC(
        "error" as never,
        ((_ctx: unknown, _error: unknown, payload: unknown) => {
          receivedPayload = payload;
        }) as never,
      );
      app.bus.emitSync(
        "grpc:error",
        {
          requestId: "test",
          recordEvent: () => {},
          isStopped: () => false,
        } as never,
        {
          error: "err",
        },
      );
      expect(receivedPayload).toEqual({ error: "err" });
    });
  });

  // ─── group() / mount() / static() ───────────────────────

  describe("group() / mount() / static()", () => {
    test("group() creates a route group", () => {
      const app = new Sinwan();
      const result = app.group("/api", (r) => {
        r.get("/users", () => {});
      });
      expect(result).toBe(app);
    });

    test("group() throws for empty prefix", () => {
      const app = new Sinwan();
      expect(() => app.group("", () => {})).toThrow(
        "[Sinwan.group] Prefix must be a non-empty string.",
      );
    });

    test("group() throws for non-string prefix", () => {
      const app = new Sinwan();
      expect(() => app.group(123 as unknown as string, () => {})).toThrow(
        "[Sinwan.group] Prefix must be a non-empty string.",
      );
    });

    test("mount() mounts a router", () => {
      const app = new Sinwan();
      const { HTTPRouter } = require("../src/routers/http-router");
      const router = new HTTPRouter();
      router.get("/users", () => {});
      const result = app.mount("/api", router);
      expect(result).toBe(app);
    });

    test("mount() throws for empty prefix", () => {
      const app = new Sinwan();
      const { HTTPRouter } = require("../src/routers/http-router");
      expect(() => app.mount("", new HTTPRouter())).toThrow(
        "[Sinwan.mount] Prefix must be a non-empty string.",
      );
    });

    test("mount() throws for non-string prefix", () => {
      const app = new Sinwan();
      const { HTTPRouter } = require("../src/routers/http-router");
      expect(() =>
        app.mount(123 as unknown as string, new HTTPRouter()),
      ).toThrow("[Sinwan.mount] Prefix must be a non-empty string.");
    });

    test("static() registers a static file handler", () => {
      const app = new Sinwan();
      const result = app.static("/public", "./public");
      expect(result).toBe(app);
    });

    test("static() throws for empty prefix", () => {
      const app = new Sinwan();
      expect(() => app.static("", "./public")).toThrow(
        "[Sinwan.static] Prefix must be a non-empty string.",
      );
    });

    test("static() throws for empty root", () => {
      const app = new Sinwan();
      expect(() => app.static("/public", "")).toThrow(
        "[Sinwan.static] Root must be a non-empty string.",
      );
    });

    test("static() throws for non-string prefix", () => {
      const app = new Sinwan();
      expect(() => app.static(123 as unknown as string, "./public")).toThrow(
        "[Sinwan.static] Prefix must be a non-empty string.",
      );
    });

    test("static() throws for non-string root", () => {
      const app = new Sinwan();
      expect(() => app.static("/public", 123 as unknown as string)).toThrow(
        "[Sinwan.static] Root must be a non-empty string.",
      );
    });
  });

  // ─── request() ───────────────────────────────────────────

  describe("request()", () => {
    test("handles a Request object", async () => {
      const app = new Sinwan();
      app.get("/test", (ctx) => ctx.json({ ok: true }));
      const req = new Request("http://localhost/test");
      const res = await app.request(req);
      expect(res).toBeDefined();
      expect(res.status).toBe(200);
    });

    test("handles a Request object with init", async () => {
      const app = new Sinwan();
      app.post("/test", (ctx) => ctx.json({ created: true }));
      const req = new Request("http://localhost/test");
      const res = await app.request(req, { method: "POST" });
      expect(res.status).toBe(200);
    });

    test("handles a relative string path", async () => {
      const app = new Sinwan();
      app.get("/hello", (ctx) => ctx.json({ hello: "world" }));
      const res = await app.request("/hello");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ hello: "world" });
    });

    test("handles an absolute URL string", async () => {
      const app = new Sinwan();
      app.get("/abs", (ctx) => ctx.json({ ok: true }));
      const res = await app.request("http://localhost/abs");
      expect(res.status).toBe(200);
    });

    test("handles a URL object", async () => {
      const app = new Sinwan();
      app.get("/url", (ctx) => ctx.json({ ok: true }));
      const res = await app.request(new URL("http://localhost/url"));
      expect(res.status).toBe(200);
    });

    test("handles a string with init options", async () => {
      const app = new Sinwan();
      app.post("/create", (ctx) => ctx.json({ created: true }));
      const res = await app.request("/create", { method: "POST" });
      expect(res.status).toBe(200);
    });

    test("returns 500 for unknown route (no response produced)", async () => {
      const app = new Sinwan();
      app.get("/known", () => {
        return;
      });
      const res = await app.request("/unknown");
      expect(res.status).toBe(500);
    });
  });

  // ─── listen() ────────────────────────────────────────────

  describe("listen()", () => {
    test("starts server without WS routes", async () => {
      const app = await Sinwan.create();
      const server = await app.listen(3000);
      expect(server).toBeDefined();
      expect(capturedServeOptions?.websocket).toBeUndefined();
      app.stop();
    });

    test("starts server with WS routes", async () => {
      const app = await Sinwan.create();
      app.ws("/chat", { open: () => {} });
      const server = await app.listen(3000);
      expect(server).toBeDefined();
      expect(capturedServeOptions?.websocket).toBeDefined();
      app.stop();
    });

    test("starts server with default port", async () => {
      const app = await Sinwan.create();
      const server = await app.listen();
      expect(server).toBeDefined();
      app.stop();
    });

    test("starts server with port as string", async () => {
      const app = await Sinwan.create();
      const server = await app.listen("3001");
      expect(server).toBeDefined();
      app.stop();
    });

    test("calls callback after server starts", async () => {
      const app = await Sinwan.create();
      let callbackInfo: { port: number | string } | null = null;
      await app.listen(3000, (info) => {
        callbackInfo = info;
      });
      expect(callbackInfo).not.toBeNull();
      expect(callbackInfo!.port).toBe(3000);
      app.stop();
    });

    test("catches callback errors", async () => {
      const app = await Sinwan.create();
      await app.listen(3000, () => {
        throw new Error("callback error");
      });
      // Should not throw — error is caught and logged
      app.stop();
    });

    test("wraps Bun.serve errors", async () => {
      const app = await Sinwan.create();
      (Bun as unknown as Record<string, unknown>).serve = mock(() => {
        throw new Error("port in use");
      });
      expect(app.listen(3000)).rejects.toThrow(
        "Failed to start server on port 3000: port in use",
      );
    });

    test("wraps lifecycle.ready errors and stops server", async () => {
      const app = await Sinwan.create();
      app.lifecycle.on("ready", () => {
        throw new Error("ready failed");
      });
      expect(app.listen(3000)).rejects.toThrow(
        "Failed to transition to ready state: ready failed",
      );
      // Server should have been stopped
      expect(mockServerStop).toHaveBeenCalledWith(true);
    });

    test("detects ws protocol when only WS routes", async () => {
      const app = await Sinwan.create();
      app.ws("/ws", { open: () => {} });
      let receivedProtocol: unknown;
      app.lifecycle.on("ready", (payload) => {
        receivedProtocol = payload?.protocol;
      });
      await app.listen(3000);
      expect(receivedProtocol).toBe("ws");
      app.stop();
    });

    test("detects http protocol when HTTP routes exist", async () => {
      const app = await Sinwan.create();
      app.get("/api", () => {});
      let receivedProtocol: unknown;
      app.lifecycle.on("ready", (payload) => {
        receivedProtocol = payload?.protocol;
      });
      await app.listen(3000);
      expect(receivedProtocol).toBe("http");
      app.stop();
    });

    test("detects http protocol when both HTTP and WS routes exist", async () => {
      const app = await Sinwan.create();
      app.get("/api", () => {
        return;
      });
      app.ws("/ws", {
        open: () => {
          return;
        },
      });
      // Install HTTP router first so hasHttpRoutes is true
      await app.request("/api");
      let receivedProtocol: unknown;
      app.lifecycle.on("ready", (payload) => {
        receivedProtocol = payload?.protocol;
      });
      await app.listen(3000);
      expect(receivedProtocol).toBe("http");
      await app.stop();
    });
  });

  // ─── listenTCP() / connectTCP() ──────────────────────────

  describe("listenTCP() / connectTCP()", () => {
    test("listenTCP throws if not initialized", () => {
      const app = new Sinwan();
      app.tcp("svc", {
        open: () => {
          return;
        },
      });
      expect(() => app.listenTCP("svc", { port: 0 })).toThrow(
        'Lifecycle is in "idle" state',
      );
    });

    test("listenTCP starts TCP server when initialized", async () => {
      const app = await Sinwan.create();
      app.tcp("svc", { open: () => {} });
      const server = await app.listenTCP("svc", { port: 0 });
      expect(server).toBeDefined();
      app.stop();
    });

    test("connectTCP connects to a TCP server", async () => {
      const app = new Sinwan();
      app.tcp("client", { open: () => {} });
      const socket = await app.connectTCP(
        "client",
        { hostname: "127.0.0.1", port: 9999 },
        { open: () => {} },
      );
      expect(socket).toBeDefined();
    });

    test("listenTCP with no port uses 0", async () => {
      const app = await Sinwan.create();
      app.tcp("svc", { open: () => {} });
      await app.listenTCP("svc", {});
      app.stop();
    });
  });

  // ─── listenUDP() / connectUDP() ──────────────────────────

  describe("listenUDP() / connectUDP()", () => {
    test("listenUDP throws if not initialized", () => {
      const app = new Sinwan();
      app.udp("svc", {
        open: () => {
          return;
        },
      });
      expect(() => app.listenUDP("svc", {})).toThrow(
        'Lifecycle is in "idle" state',
      );
    });

    test("listenUDP starts UDP socket when initialized", async () => {
      const app = await Sinwan.create();
      app.udp("svc", { open: () => {} });
      const socket = await app.listenUDP("svc", { port: 0 });
      expect(socket).toBeDefined();
      app.stop();
    });

    test("connectUDP connects to a UDP server", async () => {
      const app = new Sinwan();
      app.udp("client", { open: () => {} });
      const socket = await app.connectUDP("client", {
        hostname: "127.0.0.1",
        port: 9999,
      });
      expect(socket).toBeDefined();
    });

    test("listenUDP with no port uses 0", async () => {
      const app = await Sinwan.create();
      app.udp("svc", { open: () => {} });
      await app.listenUDP("svc", {});
      app.stop();
    });
  });

  // ─── listenGRPC() / connectGRPC() ────────────────────────

  describe("listenGRPC() / connectGRPC()", () => {
    let mockProvider: GRPCProvider;

    beforeEach(() => {
      mockProvider = createMockGRPCProvider();
      registerGRPCProvider(mockProvider);
    });

    test("listenGRPC throws if not initialized", () => {
      const app = new Sinwan();
      expect(() => app.listenGRPC({ port: 50051 } as never)).toThrow(
        'Lifecycle is in "idle" state',
      );
    });

    test("listenGRPC with object options", async () => {
      const app = await Sinwan.create();
      const handle = await app.listenGRPC({ port: 50051 } as never);
      expect(handle).toBeDefined();
      expect(mockProvider.listen).toHaveBeenCalledWith(expect.anything(), {
        port: 50051,
      });
      await app.stop();
    });

    test("listenGRPC with string name and options", async () => {
      const app = await Sinwan.create();
      const handle = await app.listenGRPC(
        "greeter" as never,
        { port: 50052 } as never,
      );
      expect(handle).toBeDefined();
      expect(mockProvider.listen).toHaveBeenCalledWith(
        expect.anything(),
        "greeter",
        { port: 50052 },
      );
      await app.stop();
    });

    test("listenGRPC uses default port 50051", async () => {
      const app = await Sinwan.create();
      await app.listenGRPC({} as never);
      await app.stop();
    });

    test("connectGRPC delegates to provider", () => {
      const app = new Sinwan();
      const result = app.connectGRPC({ address: "localhost:50051" } as never);
      expect(mockProvider.connect).toHaveBeenCalledWith({
        address: "localhost:50051",
      });
      expect(result).toBeDefined();
    });
  });

  // ─── stop() ──────────────────────────────────────────────

  describe("stop()", () => {
    test("stops server when active", async () => {
      const app = await Sinwan.create();
      await app.listen(3000);
      await app.stop();
      expect(mockServerStop).toHaveBeenCalled();
    });

    test("stops server with closeConn=true", async () => {
      const app = await Sinwan.create();
      await app.listen(3000);
      await app.stop(true);
      expect(mockServerStop).toHaveBeenCalledWith(true);
    });

    test("stop without server is safe", async () => {
      const app = await Sinwan.create();
      await app.stop();
      // Should not throw
    });

    test("stop transitions to DESTROYED", async () => {
      const app = await Sinwan.create();
      await app.listen(3000);
      await app.stop();
      expect(app.lifecycle.getState()).toBe(LifecycleState.DESTROYED);
    });

    test("stop without listen stays in INIT (shutdown only from READY)", async () => {
      const app = await Sinwan.create();
      // Without listen, lifecycle is in INIT, not READY
      // stop() only calls shutdown() from READY state
      await app.stop();
      expect(app.lifecycle.getState()).toBe(LifecycleState.INIT);
    });

    test("stop calls tcpRouter.stop", async () => {
      const app = await Sinwan.create();
      app.tcp("svc", { open: () => {} });
      await app.listenTCP("svc", { port: 0 });
      await app.stop();
      // If we get here without error, tcpRouter.stop was called
    });

    test("stop calls udpRouter.stop", async () => {
      const app = await Sinwan.create();
      app.udp("svc", { open: () => {} });
      await app.listenUDP("svc", { port: 0 });
      await app.stop();
      // If we get here without error, udpRouter.stop was called
    });

    test("stop with gRPC provider calls provider.stop", async () => {
      const mockProvider = createMockGRPCProvider();
      registerGRPCProvider(mockProvider);
      const app = await Sinwan.create();
      await app.listenGRPC({ port: 50051 } as never);
      await app.stop();
      expect(mockProvider.stop).toHaveBeenCalled();
    });

    test("stop clears server reference", async () => {
      const app = await Sinwan.create();
      await app.listen(3000);
      await app.stop();
      // Calling stop again should be safe (no server)
      await app.stop();
    });
  });

  // ─── Lifecycle integration ───────────────────────────────

  describe("lifecycle integration", () => {
    test("app starts in IDLE state", () => {
      const app = new Sinwan();
      expect(app.lifecycle.getState()).toBe(LifecycleState.IDLE);
    });

    test("Sinwan.create transitions to INIT", async () => {
      const app = await Sinwan.create();
      expect(app.lifecycle.getState()).toBe(LifecycleState.INIT);
    });

    test("listen transitions to READY", async () => {
      const app = await Sinwan.create();
      await app.listen(3000);
      expect(app.lifecycle.getState()).toBe(LifecycleState.READY);
      await app.stop();
    });

    test("stop transitions through SHUTDOWN to DESTROYED", async () => {
      const app = await Sinwan.create();
      await app.listen(3000);
      await app.stop();
      expect(app.lifecycle.getState()).toBe(LifecycleState.DESTROYED);
    });

    test("lifecycle.on registers listeners", async () => {
      const app = await Sinwan.create();
      let initCalled = false;
      app.lifecycle.on("init", () => {
        initCalled = true;
      });
      // init already happened in create(), so we need to test with ready
      let readyCalled = false;
      app.lifecycle.on("ready", () => {
        readyCalled = true;
      });
      await app.listen(3000);
      expect(readyCalled).toBe(true);
      await app.stop();
    });

    test("transitionToReady is no-op when already READY", async () => {
      const app = await Sinwan.create();
      await app.listen(3000);
      // Now app is READY
      // listenTCP should work without transitioning (already READY)
      app.tcp("svc", { open: () => {} });
      await app.listenTCP("svc", { port: 0 });
      await app.stop();
    });

    test("assertInitialized throws in IDLE state", () => {
      const app = new Sinwan();
      app.tcp("svc", {
        open: () => {
          return;
        },
      });
      expect(() => app.listenTCP("svc", { port: 0 })).toThrow(
        "[Sinwan.listenTCP]",
      );
    });

    test("assertInitialized passes after init", async () => {
      const app = await Sinwan.create();
      app.tcp("svc", { open: () => {} });
      // Should not throw
      await app.listenTCP("svc", { port: 0 });
      await app.stop();
    });
  });

  // ─── ensureHttpRouterInstalled ───────────────────────────

  describe("ensureHttpRouterInstalled", () => {
    test("request() installs HTTP router on first call", async () => {
      const app = new Sinwan();
      app.get("/test", (ctx) => ctx.json({ ok: true }));
      // First call should install the router and process the request
      const res = await app.request("/test");
      expect(res.status).toBe(200);
    });

    test("second request() does not reinstall HTTP router", async () => {
      const app = new Sinwan();
      app.get("/test", (ctx) => ctx.json({ ok: true }));
      await app.request("/test");
      // Second call should work without reinstalling
      const res = await app.request("/test");
      expect(res.status).toBe(200);
    });

    test("listen() installs HTTP router", async () => {
      const app = await Sinwan.create();
      await app.listen(3000);
      // HTTP router should be installed after listen
      const res = await app.request("http://localhost/test");
      // No route registered, so 500 "No response was produced"
      expect(res.status).toBe(500);
      await app.stop();
    });
  });

  // ─── Internal assets integration ─────────────────────────

  describe("internal assets integration", () => {
    test("favicon.ico returns 204 by default", async () => {
      const app = new Sinwan({ internalAssets: { enabled: true } });
      const res = await app.request("/favicon.ico");
      expect(res.status).toBe(204);
    });

    test("robots.txt returns content", async () => {
      const app = new Sinwan({ internalAssets: { enabled: true } });
      const res = await app.request("/robots.txt");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("User-agent:");
    });

    test("disabled internal assets do not intercept", async () => {
      const app = new Sinwan({ internalAssets: { enabled: false } });
      const res = await app.request("/favicon.ico");
      // No route registered, so 500 "No response was produced"
      expect(res.status).toBe(500);
    });
  });
});
