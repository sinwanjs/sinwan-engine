import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import {
  TCPRouter,
  type TCPRouteConfig,
  type TCPClientConfig,
  type TCPListenOptions,
} from "../../src/routers/tcp-router";
import { Runtime, type RuntimeConfig } from "../../src/runtime";
import { StepEngine } from "../../src/step-engine";
import { EventBus } from "../../src/event-bus";
import { ErrorHandler } from "../../src/error-handler";
import type { Context, TCPData } from "../../src/context/context";
import type { Socket } from "bun";
import type { Step, StepResult } from "../../src/types";

function createRuntime(overrides?: Partial<RuntimeConfig>): Runtime {
  const engine = new StepEngine();
  const bus = new EventBus();
  const errorHandler = new ErrorHandler();
  const globalState = new Map<string, unknown>();
  return new Runtime({ engine, bus, errorHandler, globalState, ...overrides });
}

function createMockTCPSocket(
  name: string = "test",
  data: unknown = null,
): Socket<TCPData> {
  return {
    data: { name, data },
    write: mock(() => 0),
    end: mock(() => 0),
    flush: mock(() => true),
    timeout: mock(() => {}),
    remoteAddress: "127.0.0.1",
    localAddress: "127.0.0.1",
    readyState: 1,
  } as unknown as Socket<TCPData>;
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

interface CapturedSocket {
  open?: (socket: Socket<TCPData>) => void;
  data?: (socket: Socket<TCPData>, data: Buffer) => void;
  close?: (socket: Socket<TCPData>, error?: Error) => void;
  drain?: (socket: Socket<TCPData>) => void;
  error?: (socket: Socket<TCPData>, error: Error) => void;
  connectError?: (socket: Socket<TCPData>, error: Error) => void;
  end?: (socket: Socket<TCPData>) => void;
  timeout?: (socket: Socket<TCPData>) => void;
}

describe("TCPRouter", () => {
  let originalListen: typeof Bun.listen;
  let originalConnect: typeof Bun.connect;
  let capturedListenSocket: CapturedSocket | null = null;
  let capturedConnectSocket: CapturedSocket | null = null;
  let capturedListenOptions: Record<string, unknown> | null = null;
  let capturedConnectOptions: Record<string, unknown> | null = null;
  let mockServerStop: ReturnType<typeof mock>;
  let mockServers: { stop: ReturnType<typeof mock> }[];

  beforeEach(() => {
    originalListen = Bun.listen;
    originalConnect = Bun.connect;
    capturedListenSocket = null;
    capturedConnectSocket = null;
    capturedListenOptions = null;
    capturedConnectOptions = null;
    mockServerStop = mock(() => {});
    mockServers = [];

    (Bun as unknown as Record<string, unknown>).listen = mock(
      (opts: Record<string, unknown>) => {
        capturedListenOptions = opts;
        capturedListenSocket = opts.socket as CapturedSocket;
        const server = { stop: mockServerStop, port: 0, hostname: "localhost" };
        mockServers.push(server);
        return server;
      },
    );

    (Bun as unknown as Record<string, unknown>).connect = mock(
      (opts: Record<string, unknown>) => {
        capturedConnectOptions = opts;
        capturedConnectSocket = opts.socket as CapturedSocket;
        return Promise.resolve(createMockTCPSocket());
      },
    );
  });

  afterEach(() => {
    (Bun as unknown as Record<string, unknown>).listen = originalListen;
    (Bun as unknown as Record<string, unknown>).connect = originalConnect;
  });

  // ─── Route registration ──────────────────────────────────

  describe("route registration", () => {
    test("tcp() registers a route", () => {
      const router = new TCPRouter();
      router.tcp("my-route", { open: () => {} });
      expect(router.hasRoutes()).toBe(true);
    });

    test("hasRoutes() returns false when no routes", () => {
      const router = new TCPRouter();
      expect(router.hasRoutes()).toBe(false);
    });

    test("hasRoutes() returns true after registering", () => {
      const router = new TCPRouter();
      router.tcp("my-route", { open: () => {} });
      expect(router.hasRoutes()).toBe(true);
    });

    test("name is correct", () => {
      const router = new TCPRouter();
      expect(router.name).toBe("sinwan:tcp-router");
    });
  });

  // ─── listen() ────────────────────────────────────────────

  describe("listen()", () => {
    test("throws for unregistered route", () => {
      const router = new TCPRouter();
      const runtime = createRuntime();
      expect(() => router.listen(runtime, "unknown", { port: 0 })).toThrow(
        'TCP route "unknown" is not registered.',
      );
    });

    test("creates server with hostname/port defaults", () => {
      const router = new TCPRouter();
      router.tcp("svc", { open: () => {} });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      expect(capturedListenOptions).toBeDefined();
      expect(capturedListenOptions?.hostname).toBe("localhost");
      expect(capturedListenOptions?.port).toBe(0);
    });

    test("creates server with custom hostname", () => {
      const router = new TCPRouter();
      router.tcp("svc", { open: () => {} });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { hostname: "0.0.0.0", port: 8080 });
      expect(capturedListenOptions?.hostname).toBe("0.0.0.0");
      expect(capturedListenOptions?.port).toBe(8080);
    });

    test("creates server with unix socket", () => {
      const router = new TCPRouter();
      router.tcp("svc", { open: () => {} });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { unix: "/tmp/test.sock" });
      expect(capturedListenOptions?.unix).toBe("/tmp/test.sock");
      expect(capturedListenOptions?.hostname).toBeUndefined();
    });

    test("creates server with TLS on non-unix", () => {
      const router = new TCPRouter();
      router.tcp("svc", { open: () => {} });
      const runtime = createRuntime();
      router.listen(runtime, "svc", {
        port: 0,
        tls: { key: "key", cert: "cert" },
      });
      expect(capturedListenOptions?.tls).toEqual({ key: "key", cert: "cert" });
    });

    test("creates server without TLS on non-unix when not provided", () => {
      const router = new TCPRouter();
      router.tcp("svc", { open: () => {} });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      expect(capturedListenOptions?.tls).toBeUndefined();
    });

    test("creates unix server with TLS when key is defined", () => {
      const router = new TCPRouter();
      router.tcp("svc", { open: () => {} });
      const runtime = createRuntime();
      router.listen(runtime, "svc", {
        unix: "/tmp/test.sock",
        tls: { key: "key", cert: "cert" },
      });
      expect(capturedListenOptions?.tls).toEqual({ key: "key", cert: "cert" });
    });

    test("creates unix server without TLS when key is undefined", () => {
      const router = new TCPRouter();
      router.tcp("svc", { open: () => {} });
      const runtime = createRuntime();
      router.listen(runtime, "svc", {
        unix: "/tmp/test.sock",
        tls: {},
      });
      expect(capturedListenOptions?.tls).toBeUndefined();
    });

    test("passes data in options", () => {
      const router = new TCPRouter();
      router.tcp("svc", { open: () => {} });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0, data: { custom: 123 } });
      // Data is used in the open handler
      expect(capturedListenSocket).toBeDefined();
    });

    test("returns the server", () => {
      const router = new TCPRouter();
      router.tcp("svc", { open: () => {} });
      const runtime = createRuntime();
      const server = router.listen(runtime, "svc", { port: 0 });
      expect(server).toBeDefined();
      expect(typeof server.stop).toBe("function");
    });
  });

  // ─── listen() socket handlers ────────────────────────────

  describe("listen() socket handlers", () => {
    test("open handler sets socket data and calls hook", async () => {
      const router = new TCPRouter();
      let hookCalled = false;
      router.tcp("svc", {
        open: () => {
          hookCalled = true;
        },
      });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0, data: "hello" });
      const sock = createMockTCPSocket();
      capturedListenSocket!.open!(sock);
      await flushPromises();
      expect(hookCalled).toBe(true);
      expect(sock.data).toEqual({ name: "svc", data: "hello" });
    });

    test("data handler calls hook with data", async () => {
      const router = new TCPRouter();
      let receivedData: Buffer | undefined;
      router.tcp("svc", {
        data: (_ctx, data) => {
          receivedData = data;
        },
      });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      const buf = Buffer.from("test-data");
      capturedListenSocket!.data!(sock, buf);
      await flushPromises();
      expect(receivedData).toBe(buf);
    });

    test("close handler calls hook with error", async () => {
      const router = new TCPRouter();
      let receivedError: Error | undefined;
      router.tcp("svc", {
        close: (_ctx, err) => {
          receivedError = err;
        },
      });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      const closeError = new Error("closed");
      capturedListenSocket!.close!(sock, closeError);
      await flushPromises();
      expect(receivedError).toBe(closeError);
    });

    test("close handler calls hook without error", async () => {
      const router = new TCPRouter();
      let hookCalled = false;
      router.tcp("svc", {
        close: () => {
          hookCalled = true;
        },
      });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      capturedListenSocket!.close!(sock);
      await flushPromises();
      expect(hookCalled).toBe(true);
    });

    test("drain handler calls hook", async () => {
      const router = new TCPRouter();
      let hookCalled = false;
      router.tcp("svc", {
        drain: () => {
          hookCalled = true;
        },
      });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      capturedListenSocket!.drain!(sock);
      await flushPromises();
      expect(hookCalled).toBe(true);
    });

    test("error handler calls hook with error", async () => {
      const router = new TCPRouter();
      let receivedError: Error | undefined;
      router.tcp("svc", {
        error: (_ctx, err) => {
          receivedError = err;
        },
      });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      const testError = new Error("socket error");
      capturedListenSocket!.error!(sock, testError);
      await flushPromises();
      expect(receivedError).toBe(testError);
    });
  });

  // ─── connect() ───────────────────────────────────────────

  describe("connect()", () => {
    test("connects with hostname/port", async () => {
      const router = new TCPRouter();
      const runtime = createRuntime();
      const config: TCPClientConfig = { open: () => {} };
      const result = router.connect(
        runtime,
        "client",
        {
          hostname: "127.0.0.1",
          port: 9999,
        },
        config,
      );
      await result;
      expect(capturedConnectOptions?.hostname).toBe("127.0.0.1");
      expect(capturedConnectOptions?.port).toBe(9999);
    });

    test("connects with unix socket", async () => {
      const router = new TCPRouter();
      const runtime = createRuntime();
      const config: TCPClientConfig = { open: () => {} };
      const result = router.connect(
        runtime,
        "client",
        {
          unix: "/tmp/test.sock",
        },
        config,
      );
      await result;
      expect(capturedConnectOptions?.unix).toBe("/tmp/test.sock");
    });

    test("connects with TLS", async () => {
      const router = new TCPRouter();
      const runtime = createRuntime();
      const config: TCPClientConfig = { open: () => {} };
      router.connect(
        runtime,
        "client",
        {
          port: 9999,
          tls: { key: "k", cert: "c" },
        },
        config,
      );
      expect(capturedConnectOptions?.tls).toEqual({ key: "k", cert: "c" });
    });

    test("connects without TLS", async () => {
      const router = new TCPRouter();
      const runtime = createRuntime();
      const config: TCPClientConfig = { open: () => {} };
      router.connect(runtime, "client", { port: 9999 }, config);
      expect(capturedConnectOptions?.tls).toBeUndefined();
    });

    test("passes data in connect options", async () => {
      const router = new TCPRouter();
      const runtime = createRuntime();
      const config: TCPClientConfig = { open: () => {} };
      router.connect(
        runtime,
        "client",
        {
          port: 9999,
          data: { custom: 42 },
        },
        config,
      );
      expect(capturedConnectOptions?.data).toEqual({
        name: "client",
        data: { custom: 42 },
      });
    });
  });

  // ─── connect() socket handlers ───────────────────────────

  describe("connect() socket handlers", () => {
    test("open handler sets socket data and calls hook", async () => {
      const router = new TCPRouter();
      let hookCalled = false;
      const config: TCPClientConfig = {
        open: () => {
          hookCalled = true;
        },
      };
      const runtime = createRuntime();
      router.connect(runtime, "client", { port: 9999, data: "hi" }, config);
      const sock = createMockTCPSocket();
      capturedConnectSocket!.open!(sock);
      await flushPromises();
      expect(hookCalled).toBe(true);
      expect(sock.data).toEqual({ name: "client", data: "hi" });
    });

    test("data handler calls hook with data", async () => {
      const router = new TCPRouter();
      let receivedData: Buffer | undefined;
      const config: TCPClientConfig = {
        data: (_ctx, data) => {
          receivedData = data;
        },
      };
      const runtime = createRuntime();
      router.connect(runtime, "client", { port: 9999 }, config);
      const sock = createMockTCPSocket();
      const buf = Buffer.from("msg");
      capturedConnectSocket!.data!(sock, buf);
      await flushPromises();
      expect(receivedData).toBe(buf);
    });

    test("close handler calls hook with error", async () => {
      const router = new TCPRouter();
      let receivedError: Error | undefined;
      const config: TCPClientConfig = {
        close: (_ctx, err) => {
          receivedError = err;
        },
      };
      const runtime = createRuntime();
      router.connect(runtime, "client", { port: 9999 }, config);
      const sock = createMockTCPSocket();
      const closeError = new Error("closed");
      capturedConnectSocket!.close!(sock, closeError);
      await flushPromises();
      expect(receivedError).toBe(closeError);
    });

    test("close handler calls hook without error", async () => {
      const router = new TCPRouter();
      let hookCalled = false;
      const config: TCPClientConfig = {
        close: () => {
          hookCalled = true;
        },
      };
      const runtime = createRuntime();
      router.connect(runtime, "client", { port: 9999 }, config);
      const sock = createMockTCPSocket();
      capturedConnectSocket!.close!(sock);
      await flushPromises();
      expect(hookCalled).toBe(true);
    });

    test("drain handler calls hook", async () => {
      const router = new TCPRouter();
      let hookCalled = false;
      const config: TCPClientConfig = {
        drain: () => {
          hookCalled = true;
        },
      };
      const runtime = createRuntime();
      router.connect(runtime, "client", { port: 9999 }, config);
      const sock = createMockTCPSocket();
      capturedConnectSocket!.drain!(sock);
      await flushPromises();
      expect(hookCalled).toBe(true);
    });

    test("error handler calls hook with error", async () => {
      const router = new TCPRouter();
      let receivedError: Error | undefined;
      const config: TCPClientConfig = {
        error: (_ctx, err) => {
          receivedError = err;
        },
      };
      const runtime = createRuntime();
      router.connect(runtime, "client", { port: 9999 }, config);
      const sock = createMockTCPSocket();
      const testError = new Error("connect error");
      capturedConnectSocket!.error!(sock, testError);
      await flushPromises();
      expect(receivedError).toBe(testError);
    });

    test("connectError handler sets socket data if not set", async () => {
      const router = new TCPRouter();
      let hookCalled = false;
      const config: TCPClientConfig = {
        connectError: () => {
          hookCalled = true;
        },
      };
      const runtime = createRuntime();
      router.connect(runtime, "client", { port: 9999, data: "info" }, config);
      const sock = createMockTCPSocket();
      // Simulate socket.data being null (connectError before open)
      (sock as unknown as { data: unknown }).data = null;
      const connectError = new Error("refused");
      capturedConnectSocket!.connectError!(sock, connectError);
      await flushPromises();
      expect(hookCalled).toBe(true);
      expect(sock.data).toEqual({ name: "client", data: "info" });
    });

    test("connectError handler does not overwrite existing socket data", async () => {
      const router = new TCPRouter();
      const config: TCPClientConfig = {
        connectError: () => {},
      };
      const runtime = createRuntime();
      router.connect(runtime, "client", { port: 9999, data: "info" }, config);
      const sock = createMockTCPSocket();
      const existingData = { name: "existing", data: "old" };
      (sock as unknown as { data: unknown }).data = existingData;
      capturedConnectSocket!.connectError!(sock, new Error("refused"));
      await flushPromises();
      expect(sock.data).toBe(existingData);
    });

    test("end handler calls hook", async () => {
      const router = new TCPRouter();
      let hookCalled = false;
      const config: TCPClientConfig = {
        end: () => {
          hookCalled = true;
        },
      };
      const runtime = createRuntime();
      router.connect(runtime, "client", { port: 9999 }, config);
      const sock = createMockTCPSocket();
      capturedConnectSocket!.end!(sock);
      await flushPromises();
      expect(hookCalled).toBe(true);
    });

    test("timeout handler calls hook", async () => {
      const router = new TCPRouter();
      let hookCalled = false;
      const config: TCPClientConfig = {
        timeout: () => {
          hookCalled = true;
        },
      };
      const runtime = createRuntime();
      router.connect(runtime, "client", { port: 9999 }, config);
      const sock = createMockTCPSocket();
      capturedConnectSocket!.timeout!(sock);
      await flushPromises();
      expect(hookCalled).toBe(true);
    });
  });

  // ─── runTCPHook — tcp:open through engine ────────────────

  describe("runTCPHook — tcp:open engine pipeline", () => {
    test("open hook runs after engine pipeline (sync)", async () => {
      const router = new TCPRouter();
      let hookCalled = false;
      router.tcp("svc", {
        open: () => {
          hookCalled = true;
        },
      });
      const engine = new StepEngine();
      const bus = new EventBus();
      const errorHandler = new ErrorHandler();
      const globalState = new Map<string, unknown>();
      const runtime = new Runtime({ engine, bus, errorHandler, globalState });
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      capturedListenSocket!.open!(sock);
      await flushPromises();
      expect(hookCalled).toBe(true);
    });

    test("open hook runs after async engine pipeline", async () => {
      const router = new TCPRouter();
      let hookCalled = false;
      router.tcp("svc", {
        open: () => {
          hookCalled = true;
        },
      });
      const asyncStep: Step = {
        name: "async-step",
        run: async () => {
          await new Promise((r) => setTimeout(r, 5));
          return { type: "continue" } as StepResult;
        },
      };
      const engine = new StepEngine();
      engine.add(asyncStep);
      const bus = new EventBus();
      const errorHandler = new ErrorHandler();
      const globalState = new Map<string, unknown>();
      const runtime = new Runtime({ engine, bus, errorHandler, globalState });
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      capturedListenSocket!.open!(sock);
      await flushPromises();
      expect(hookCalled).toBe(true);
    });

    test("open hook is skipped when ctx.stop() in engine", async () => {
      const router = new TCPRouter();
      let hookCalled = false;
      router.tcp("svc", {
        open: () => {
          hookCalled = true;
        },
      });
      const stopStep: Step = {
        name: "stop-step",
        run: (ctx: Context) => {
          ctx.stop();
          return { type: "stop" } as StepResult;
        },
      };
      const engine = new StepEngine();
      engine.add(stopStep);
      const bus = new EventBus();
      const errorHandler = new ErrorHandler();
      const globalState = new Map<string, unknown>();
      const runtime = new Runtime({ engine, bus, errorHandler, globalState });
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      capturedListenSocket!.open!(sock);
      await flushPromises();
      expect(hookCalled).toBe(false);
    });

    test("open hook error in engine pipeline is caught", async () => {
      const router = new TCPRouter();
      let hookCalled = false;
      router.tcp("svc", {
        open: () => {
          hookCalled = true;
        },
      });
      const errorStep: Step = {
        name: "error-step",
        run: () => {
          throw new Error("engine fail");
        },
      };
      const engine = new StepEngine();
      engine.add(errorStep);
      const bus = new EventBus();
      const errorHandler = new ErrorHandler();
      const globalState = new Map<string, unknown>();
      const runtime = new Runtime({ engine, bus, errorHandler, globalState });
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      expect(() => capturedListenSocket!.open!(sock)).not.toThrow();
      await flushPromises();
      expect(hookCalled).toBe(false);
    });
  });

  // ─── runTCPHook — early return ───────────────────────────

  describe("runTCPHook — early return", () => {
    test("no hook and no listeners = early return (non-open)", async () => {
      const router = new TCPRouter();
      router.tcp("svc", {});
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      // data handler with no data hook and no listeners
      expect(() =>
        capturedListenSocket!.data!(sock, Buffer.from("x")),
      ).not.toThrow();
      await flushPromises();
    });

    test("no hook and no listeners = early return (open)", async () => {
      const router = new TCPRouter();
      router.tcp("svc", {});
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      expect(() => capturedListenSocket!.open!(sock)).not.toThrow();
      await flushPromises();
    });
  });

  // ─── runTCPHookPostEngine — bus events ───────────────────

  describe("bus events", () => {
    test("emits tcp:open event", async () => {
      const router = new TCPRouter();
      router.tcp("svc", { open: () => {} });
      const bus = new EventBus();
      let eventFired = false;
      bus.on("tcp:open", () => {
        eventFired = true;
      });
      const runtime = createRuntime({ bus });
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      capturedListenSocket!.open!(sock);
      await flushPromises();
      expect(eventFired).toBe(true);
    });

    test("emits tcp:data event with payload", async () => {
      const router = new TCPRouter();
      router.tcp("svc", { data: () => {} });
      const bus = new EventBus();
      let receivedPayload: unknown;
      bus.on("tcp:data", (_ctx, payload) => {
        receivedPayload = payload;
      });
      const runtime = createRuntime({ bus });
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      const buf = Buffer.from("data");
      capturedListenSocket!.data!(sock, buf);
      await flushPromises();
      expect(receivedPayload).toEqual({ name: "svc", data: buf });
    });

    test("emits tcp:close event with error", async () => {
      const router = new TCPRouter();
      router.tcp("svc", { close: () => {} });
      const bus = new EventBus();
      let receivedPayload: unknown;
      bus.on("tcp:close", (_ctx, payload) => {
        receivedPayload = payload;
      });
      const runtime = createRuntime({ bus });
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      const closeError = new Error("closed");
      capturedListenSocket!.close!(sock, closeError);
      await flushPromises();
      expect(receivedPayload).toEqual({ name: "svc", error: closeError });
    });

    test("emits tcp:drain event", async () => {
      const router = new TCPRouter();
      router.tcp("svc", { drain: () => {} });
      const bus = new EventBus();
      let eventFired = false;
      bus.on("tcp:drain", () => {
        eventFired = true;
      });
      const runtime = createRuntime({ bus });
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      capturedListenSocket!.drain!(sock);
      await flushPromises();
      expect(eventFired).toBe(true);
    });

    test("emits tcp:error event with error", async () => {
      const router = new TCPRouter();
      router.tcp("svc", { error: () => {} });
      const bus = new EventBus();
      let receivedPayload: unknown;
      bus.on("tcp:error", (_ctx, payload) => {
        receivedPayload = payload;
      });
      const runtime = createRuntime({ bus });
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      const testError = new Error("boom");
      capturedListenSocket!.error!(sock, testError);
      await flushPromises();
      expect(receivedPayload).toEqual({ name: "svc", error: testError });
    });

    test("bus event fires even without a hook", async () => {
      const router = new TCPRouter();
      router.tcp("svc", {});
      const bus = new EventBus();
      let eventFired = false;
      bus.on("tcp:data", () => {
        eventFired = true;
      });
      const runtime = createRuntime({ bus });
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      capturedListenSocket!.data!(sock, Buffer.from("x"));
      await flushPromises();
      expect(eventFired).toBe(true);
    });

    test("connect bus events: tcp:end", async () => {
      const router = new TCPRouter();
      const config: TCPClientConfig = { end: () => {} };
      const bus = new EventBus();
      let eventFired = false;
      bus.on("tcp:end", () => {
        eventFired = true;
      });
      const runtime = createRuntime({ bus });
      router.connect(runtime, "client", { port: 9999 }, config);
      const sock = createMockTCPSocket();
      capturedConnectSocket!.end!(sock);
      await flushPromises();
      expect(eventFired).toBe(true);
    });

    test("connect bus events: tcp:timeout", async () => {
      const router = new TCPRouter();
      const config: TCPClientConfig = { timeout: () => {} };
      const bus = new EventBus();
      let eventFired = false;
      bus.on("tcp:timeout", () => {
        eventFired = true;
      });
      const runtime = createRuntime({ bus });
      router.connect(runtime, "client", { port: 9999 }, config);
      const sock = createMockTCPSocket();
      capturedConnectSocket!.timeout!(sock);
      await flushPromises();
      expect(eventFired).toBe(true);
    });

    test("connect bus events: tcp:connectError", async () => {
      const router = new TCPRouter();
      const config: TCPClientConfig = { connectError: () => {} };
      const bus = new EventBus();
      let receivedPayload: unknown;
      bus.on("tcp:connectError", (_ctx, payload) => {
        receivedPayload = payload;
      });
      const runtime = createRuntime({ bus });
      router.connect(runtime, "client", { port: 9999 }, config);
      const sock = createMockTCPSocket();
      const connectError = new Error("refused");
      capturedConnectSocket!.connectError!(sock, connectError);
      await flushPromises();
      expect(receivedPayload).toEqual({ name: "client", error: connectError });
    });
  });

  // ─── Hook error handling ─────────────────────────────────

  describe("hook error handling", () => {
    test("sync hook error is caught (non-open)", async () => {
      const router = new TCPRouter();
      router.tcp("svc", {
        data: () => {
          throw new Error("hook fail");
        },
      });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      expect(() =>
        capturedListenSocket!.data!(sock, Buffer.from("x")),
      ).not.toThrow();
      await flushPromises();
    });

    test("async hook error is caught (non-open)", async () => {
      const router = new TCPRouter();
      router.tcp("svc", {
        data: async () => {
          await new Promise((r) => setTimeout(r, 1));
          throw new Error("async hook fail");
        },
      });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      expect(() =>
        capturedListenSocket!.data!(sock, Buffer.from("x")),
      ).not.toThrow();
      await flushPromises();
    });

    test("sync hook error is caught (open path)", async () => {
      const router = new TCPRouter();
      router.tcp("svc", {
        open: () => {
          throw new Error("open hook fail");
        },
      });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      expect(() => capturedListenSocket!.open!(sock)).not.toThrow();
      await flushPromises();
    });

    test("hook error in connect socket is caught", async () => {
      const router = new TCPRouter();
      const config: TCPClientConfig = {
        data: () => {
          throw new Error("connect hook fail");
        },
      };
      const runtime = createRuntime();
      router.connect(runtime, "client", { port: 9999 }, config);
      const sock = createMockTCPSocket();
      expect(() =>
        capturedConnectSocket!.data!(sock, Buffer.from("x")),
      ).not.toThrow();
      await flushPromises();
    });

    test("connectError hook error is caught", async () => {
      const router = new TCPRouter();
      const config: TCPClientConfig = {
        connectError: () => {
          throw new Error("connectError hook fail");
        },
      };
      const runtime = createRuntime();
      router.connect(runtime, "client", { port: 9999 }, config);
      const sock = createMockTCPSocket();
      (sock as unknown as { data: unknown }).data = null;
      expect(() =>
        capturedConnectSocket!.connectError!(sock, new Error("refused")),
      ).not.toThrow();
      await flushPromises();
    });
  });

  // ─── ctx.stop() prevents hook ────────────────────────────

  describe("ctx.stop() prevents hook", () => {
    test("bus listener stops ctx, hook not called (non-open)", async () => {
      const router = new TCPRouter();
      let hookCalled = false;
      router.tcp("svc", {
        data: () => {
          hookCalled = true;
        },
      });
      const bus = new EventBus();
      bus.on("tcp:data", (ctx: Context) => {
        ctx.stop();
      });
      const runtime = createRuntime({ bus });
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      capturedListenSocket!.data!(sock, Buffer.from("x"));
      await flushPromises();
      expect(hookCalled).toBe(false);
    });
  });

  // ─── stop() ──────────────────────────────────────────────

  describe("stop()", () => {
    test("stops all servers", () => {
      const router = new TCPRouter();
      router.tcp("svc1", { open: () => {} });
      router.tcp("svc2", { open: () => {} });
      const runtime = createRuntime();
      router.listen(runtime, "svc1", { port: 0 });
      router.listen(runtime, "svc2", { port: 0 });
      router.stop();
      // Both servers should have stop called
      // Since we use a shared mockServerStop, check it was called twice
      expect(mockServerStop).toHaveBeenCalledTimes(2);
    });

    test("stop with closeActiveConnections=true", () => {
      const router = new TCPRouter();
      router.tcp("svc", { open: () => {} });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      router.stop(true);
      expect(mockServerStop).toHaveBeenCalledWith(true);
    });

    test("stop with default closeActiveConnections=false", () => {
      const router = new TCPRouter();
      router.tcp("svc", { open: () => {} });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      router.stop();
      expect(mockServerStop).toHaveBeenCalledWith(false);
    });

    test("stop clears servers array", () => {
      const router = new TCPRouter();
      router.tcp("svc", { open: () => {} });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      router.stop();
      // Calling stop again should not call stop on any server
      mockServerStop.mockClear();
      router.stop();
      expect(mockServerStop).not.toHaveBeenCalled();
    });

    test("stop with no servers is safe", () => {
      const router = new TCPRouter();
      expect(() => router.stop()).not.toThrow();
    });
  });

  // ─── Async hook ──────────────────────────────────────────

  describe("async hooks", () => {
    test("async open hook is awaited after engine", async () => {
      const router = new TCPRouter();
      let hookCompleted = false;
      router.tcp("svc", {
        open: async () => {
          await new Promise((r) => setTimeout(r, 5));
          hookCompleted = true;
        },
      });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      capturedListenSocket!.open!(sock);
      await flushPromises();
      expect(hookCompleted).toBe(true);
    });

    test("async data hook is awaited", async () => {
      const router = new TCPRouter();
      let hookCompleted = false;
      router.tcp("svc", {
        data: async () => {
          await new Promise((r) => setTimeout(r, 5));
          hookCompleted = true;
        },
      });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: 0 });
      const sock = createMockTCPSocket();
      capturedListenSocket!.data!(sock, Buffer.from("x"));
      await flushPromises();
      expect(hookCompleted).toBe(true);
    });
  });

  // ─── Port as string ──────────────────────────────────────

  describe("port as string", () => {
    test("listen converts string port to number", () => {
      const router = new TCPRouter();
      router.tcp("svc", { open: () => {} });
      const runtime = createRuntime();
      router.listen(runtime, "svc", { port: "8080" });
      expect(capturedListenOptions?.port).toBe(8080);
    });

    test("connect converts string port to number", async () => {
      const router = new TCPRouter();
      const runtime = createRuntime();
      router.connect(runtime, "client", { port: "9999" }, { open: () => {} });
      expect(capturedConnectOptions?.port).toBe(9999);
    });
  });
});
