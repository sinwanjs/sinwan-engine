import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import {
  UDPRouter,
  type UDPRouteConfig,
  type UDPListenOptions,
  type UDPConnectOptions,
  type SinwanUDPSocket,
} from "../../src/routers/udp-router";
import { Runtime, type RuntimeConfig } from "../../src/runtime";
import { StepEngine } from "../../src/step-engine";
import { EventBus } from "../../src/event-bus";
import { ErrorHandler } from "../../src/error-handler";
import type { Context, UDPData } from "../../src/context/context";

function createRuntime(overrides?: Partial<RuntimeConfig>): Runtime {
  const engine = new StepEngine();
  const bus = new EventBus();
  const errorHandler = new ErrorHandler();
  const globalState = new Map<string, unknown>();
  return new Runtime({ engine, bus, errorHandler, globalState, ...overrides });
}

function createMockUDPSocket(
  name: string = "test",
  data: unknown = null,
): SinwanUDPSocket<UDPData> {
  return {
    data: { name, data },
    send: mock(() => true),
    sendMany: mock(() => 0),
    close: mock(() => {}),
    closed: false,
    hostname: "0.0.0.0",
    port: 0,
    address: "127.0.0.1",
  } as unknown as SinwanUDPSocket<UDPData>;
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

interface CapturedUDPSocket {
  data?: (
    s: SinwanUDPSocket<unknown>,
    buf: Buffer,
    port: number,
    addr: string,
  ) => void;
  drain?: () => void;
  error?: (s: SinwanUDPSocket<unknown>, error: Error) => void;
}

describe("UDPRouter", () => {
  let originalUdpSocket: typeof Bun.udpSocket;
  let capturedSocket: CapturedUDPSocket | null = null;
  let capturedOptions: Record<string, unknown> | null = null;
  let mockSocket: SinwanUDPSocket<unknown> | null = null;

  beforeEach(() => {
    originalUdpSocket = Bun.udpSocket;
    capturedSocket = null;
    capturedOptions = null;
    mockSocket = null;

    (Bun as unknown as Record<string, unknown>).udpSocket = mock(
      async (opts: Record<string, unknown>) => {
        capturedOptions = opts;
        capturedSocket = opts.socket as CapturedUDPSocket;
        mockSocket =
          createMockUDPSocket() as unknown as SinwanUDPSocket<unknown>;
        return mockSocket;
      },
    );
  });

  afterEach(() => {
    (Bun as unknown as Record<string, unknown>).udpSocket = originalUdpSocket;
  });

  // ─── Route registration ──────────────────────────────────

  describe("route registration", () => {
    test("udp() registers a route", () => {
      const router = new UDPRouter();
      router.udp("my-route", { open: () => {} });
      expect(router.hasRoutes()).toBe(true);
    });

    test("hasRoutes() returns false when no routes", () => {
      const router = new UDPRouter();
      expect(router.hasRoutes()).toBe(false);
    });

    test("hasRoutes() returns true after registering", () => {
      const router = new UDPRouter();
      router.udp("my-route", { open: () => {} });
      expect(router.hasRoutes()).toBe(true);
    });

    test("name is correct", () => {
      const router = new UDPRouter();
      expect(router.name).toBe("sinwan:udp-router");
    });
  });

  // ─── listen() ────────────────────────────────────────────

  describe("listen()", () => {
    test("throws for unregistered route", async () => {
      const router = new UDPRouter();
      const runtime = createRuntime();
      expect(router.listen(runtime, "unknown", {})).rejects.toThrow(
        'UDP route "unknown" is not registered.',
      );
    });

    test("creates socket with hostname/port defaults", async () => {
      const router = new UDPRouter();
      router.udp("svc", { open: () => {} });
      const runtime = createRuntime();
      await router.listen(runtime, "svc", {});
      expect(capturedOptions?.hostname).toBe("0.0.0.0");
      expect(capturedOptions?.port).toBeUndefined();
    });

    test("creates socket with custom hostname and port", async () => {
      const router = new UDPRouter();
      router.udp("svc", { open: () => {} });
      const runtime = createRuntime();
      await router.listen(runtime, "svc", {
        hostname: "127.0.0.1",
        port: 8080,
      });
      expect(capturedOptions?.hostname).toBe("127.0.0.1");
      expect(capturedOptions?.port).toBe(8080);
    });

    test("creates socket with only port", async () => {
      const router = new UDPRouter();
      router.udp("svc", { open: () => {} });
      const runtime = createRuntime();
      await router.listen(runtime, "svc", { port: 9090 });
      expect(capturedOptions?.hostname).toBe("0.0.0.0");
      expect(capturedOptions?.port).toBe(9090);
    });

    test("sets socket data with options.data", async () => {
      const router = new UDPRouter();
      router.udp("svc", { open: () => {} });
      const runtime = createRuntime();
      const result = await router.listen(runtime, "svc", {
        port: 0,
        data: "hello",
      });
      expect(result.data).toEqual({ name: "svc", data: "hello" });
    });

    test("sets socket data with null when no data provided", async () => {
      const router = new UDPRouter();
      router.udp("svc", { open: () => {} });
      const runtime = createRuntime();
      const result = await router.listen(runtime, "svc", {});
      expect(result.data).toEqual({ name: "svc", data: null });
    });

    test("returns the socket", async () => {
      const router = new UDPRouter();
      router.udp("svc", { open: () => {} });
      const runtime = createRuntime();
      const result = await router.listen(runtime, "svc", { port: 0 });
      expect(result).toBeDefined();
      expect(typeof result.send).toBe("function");
    });

    test("triggers open hook after socket creation", async () => {
      const router = new UDPRouter();
      let hookCalled = false;
      router.udp("svc", {
        open: () => {
          hookCalled = true;
        },
      });
      const runtime = createRuntime();
      await router.listen(runtime, "svc", { port: 0 });
      await flushPromises();
      expect(hookCalled).toBe(true);
    });
  });

  // ─── listen() socket handlers ────────────────────────────

  describe("listen() socket handlers", () => {
    test("data handler calls hook with data, port, addr", async () => {
      const router = new UDPRouter();
      let receivedData: Buffer | undefined;
      let receivedPort: number | undefined;
      let receivedAddr: string | undefined;
      router.udp("svc", {
        data: (_ctx, data, port, addr) => {
          receivedData = data;
          receivedPort = port;
          receivedAddr = addr;
        },
      });
      const runtime = createRuntime();
      await router.listen(runtime, "svc", { port: 0 });
      const buf = Buffer.from("test-data");
      capturedSocket!.data!(mockSocket!, buf, 12345, "192.168.1.1");
      await flushPromises();
      expect(receivedData).toBe(buf);
      expect(receivedPort).toBe(12345);
      expect(receivedAddr).toBe("192.168.1.1");
    });

    test("drain handler calls hook", async () => {
      const router = new UDPRouter();
      let hookCalled = false;
      router.udp("svc", {
        drain: () => {
          hookCalled = true;
        },
      });
      const runtime = createRuntime();
      await router.listen(runtime, "svc", { port: 0 });
      capturedSocket!.drain!();
      await flushPromises();
      expect(hookCalled).toBe(true);
    });

    test("error handler calls hook with error", async () => {
      const router = new UDPRouter();
      let receivedError: Error | undefined;
      router.udp("svc", {
        error: (_ctx, err) => {
          receivedError = err;
        },
      });
      const runtime = createRuntime();
      await router.listen(runtime, "svc", { port: 0 });
      const testError = new Error("socket error");
      capturedSocket!.error!(mockSocket!, testError);
      await flushPromises();
      expect(receivedError).toBe(testError);
    });
  });

  // ─── connect() ───────────────────────────────────────────

  describe("connect()", () => {
    test("throws for unregistered route", async () => {
      const router = new UDPRouter();
      const runtime = createRuntime();
      expect(
        router.connect(runtime, "unknown", {
          hostname: "127.0.0.1",
          port: 9999,
        }),
      ).rejects.toThrow('UDP route "unknown" is not registered.');
    });

    test("creates socket with connect options", async () => {
      const router = new UDPRouter();
      router.udp("client", { open: () => {} });
      const runtime = createRuntime();
      await router.connect(runtime, "client", {
        hostname: "127.0.0.1",
        port: 9999,
      });
      expect(capturedOptions?.connect).toEqual({
        hostname: "127.0.0.1",
        port: 9999,
      });
    });

    test("sets socket data with options.data", async () => {
      const router = new UDPRouter();
      router.udp("client", { open: () => {} });
      const runtime = createRuntime();
      const result = await router.connect(runtime, "client", {
        hostname: "127.0.0.1",
        port: 9999,
        data: { custom: 42 },
      });
      expect(result.data).toEqual({ name: "client", data: { custom: 42 } });
    });

    test("sets socket data with null when no data provided", async () => {
      const router = new UDPRouter();
      router.udp("client", { open: () => {} });
      const runtime = createRuntime();
      const result = await router.connect(runtime, "client", {
        hostname: "127.0.0.1",
        port: 9999,
      });
      expect(result.data).toEqual({ name: "client", data: null });
    });

    test("triggers open hook after connect", async () => {
      const router = new UDPRouter();
      let hookCalled = false;
      router.udp("client", {
        open: () => {
          hookCalled = true;
        },
      });
      const runtime = createRuntime();
      await router.connect(runtime, "client", {
        hostname: "127.0.0.1",
        port: 9999,
      });
      await flushPromises();
      expect(hookCalled).toBe(true);
    });

    test("returns the socket", async () => {
      const router = new UDPRouter();
      router.udp("client", { open: () => {} });
      const runtime = createRuntime();
      const result = await router.connect(runtime, "client", {
        hostname: "127.0.0.1",
        port: 9999,
      });
      expect(result).toBeDefined();
      expect(typeof result.send).toBe("function");
    });
  });

  // ─── connect() socket handlers ───────────────────────────

  describe("connect() socket handlers", () => {
    test("data handler calls hook with data, port, addr", async () => {
      const router = new UDPRouter();
      let receivedData: Buffer | undefined;
      router.udp("client", {
        data: (_ctx, data) => {
          receivedData = data;
        },
      });
      const runtime = createRuntime();
      await router.connect(runtime, "client", {
        hostname: "127.0.0.1",
        port: 9999,
      });
      const buf = Buffer.from("msg");
      capturedSocket!.data!(mockSocket!, buf, 8888, "10.0.0.1");
      await flushPromises();
      expect(receivedData).toBe(buf);
    });

    test("drain handler calls hook", async () => {
      const router = new UDPRouter();
      let hookCalled = false;
      router.udp("client", {
        drain: () => {
          hookCalled = true;
        },
      });
      const runtime = createRuntime();
      await router.connect(runtime, "client", {
        hostname: "127.0.0.1",
        port: 9999,
      });
      capturedSocket!.drain!();
      await flushPromises();
      expect(hookCalled).toBe(true);
    });

    test("error handler calls hook with error", async () => {
      const router = new UDPRouter();
      let receivedError: Error | undefined;
      router.udp("client", {
        error: (_ctx, err) => {
          receivedError = err;
        },
      });
      const runtime = createRuntime();
      await router.connect(runtime, "client", {
        hostname: "127.0.0.1",
        port: 9999,
      });
      const testError = new Error("connect error");
      capturedSocket!.error!(mockSocket!, testError);
      await flushPromises();
      expect(receivedError).toBe(testError);
    });
  });

  // ─── runUDPHook — early return ───────────────────────────

  describe("runUDPHook — early return", () => {
    test("no hook and no listeners = early return", async () => {
      const router = new UDPRouter();
      router.udp("svc", {});
      const runtime = createRuntime();
      await router.listen(runtime, "svc", { port: 0 });
      // data handler with no data hook and no listeners
      expect(() =>
        capturedSocket!.data!(mockSocket!, Buffer.from("x"), 1234, "1.2.3.4"),
      ).not.toThrow();
      await flushPromises();
    });
  });

  // ─── Bus events ──────────────────────────────────────────

  describe("bus events", () => {
    test("emits udp:open event", async () => {
      const router = new UDPRouter();
      router.udp("svc", { open: () => {} });
      const bus = new EventBus();
      let eventFired = false;
      bus.on("udp:open", () => {
        eventFired = true;
      });
      const runtime = createRuntime({ bus });
      await router.listen(runtime, "svc", { port: 0 });
      await flushPromises();
      expect(eventFired).toBe(true);
    });

    test("emits udp:data event with payload", async () => {
      const router = new UDPRouter();
      router.udp("svc", { data: () => {} });
      const bus = new EventBus();
      let receivedPayload: unknown;
      bus.on("udp:data", (_ctx, payload) => {
        receivedPayload = payload;
      });
      const runtime = createRuntime({ bus });
      await router.listen(runtime, "svc", { port: 0 });
      const buf = Buffer.from("data");
      capturedSocket!.data!(mockSocket!, buf, 12345, "192.168.1.1");
      await flushPromises();
      expect(receivedPayload).toEqual({
        name: "svc",
        data: buf,
        port: 12345,
        addr: "192.168.1.1",
      });
    });

    test("emits udp:drain event", async () => {
      const router = new UDPRouter();
      router.udp("svc", { drain: () => {} });
      const bus = new EventBus();
      let eventFired = false;
      bus.on("udp:drain", () => {
        eventFired = true;
      });
      const runtime = createRuntime({ bus });
      await router.listen(runtime, "svc", { port: 0 });
      capturedSocket!.drain!();
      await flushPromises();
      expect(eventFired).toBe(true);
    });

    test("emits udp:error event with error", async () => {
      const router = new UDPRouter();
      router.udp("svc", { error: () => {} });
      const bus = new EventBus();
      let receivedPayload: unknown;
      bus.on("udp:error", (_ctx, payload) => {
        receivedPayload = payload;
      });
      const runtime = createRuntime({ bus });
      await router.listen(runtime, "svc", { port: 0 });
      const testError = new Error("boom");
      capturedSocket!.error!(mockSocket!, testError);
      await flushPromises();
      expect(receivedPayload).toEqual({ name: "svc", error: testError });
    });

    test("emits udp:close event on stop()", async () => {
      const router = new UDPRouter();
      router.udp("svc", { close: () => {} });
      const bus = new EventBus();
      let receivedPayload: unknown;
      bus.on("udp:close", (_ctx, payload) => {
        receivedPayload = payload;
      });
      const runtime = createRuntime({ bus });
      await router.listen(runtime, "svc", { port: 0 });
      await flushPromises();
      router.stop(runtime);
      await flushPromises();
      expect(receivedPayload).toEqual({ name: "svc" });
    });

    test("bus event fires even without a hook", async () => {
      const router = new UDPRouter();
      router.udp("svc", {});
      const bus = new EventBus();
      let eventFired = false;
      bus.on("udp:data", () => {
        eventFired = true;
      });
      const runtime = createRuntime({ bus });
      await router.listen(runtime, "svc", { port: 0 });
      capturedSocket!.data!(mockSocket!, Buffer.from("x"), 1234, "1.2.3.4");
      await flushPromises();
      expect(eventFired).toBe(true);
    });
  });

  // ─── Hook error handling ─────────────────────────────────

  describe("hook error handling", () => {
    test("sync hook error is caught", async () => {
      const router = new UDPRouter();
      router.udp("svc", {
        data: () => {
          throw new Error("hook fail");
        },
      });
      const runtime = createRuntime();
      await router.listen(runtime, "svc", { port: 0 });
      expect(() =>
        capturedSocket!.data!(mockSocket!, Buffer.from("x"), 1234, "1.2.3.4"),
      ).not.toThrow();
      await flushPromises();
    });

    test("async hook error is caught", async () => {
      const router = new UDPRouter();
      router.udp("svc", {
        data: async () => {
          await new Promise((r) => setTimeout(r, 1));
          throw new Error("async hook fail");
        },
      });
      const runtime = createRuntime();
      await router.listen(runtime, "svc", { port: 0 });
      expect(() =>
        capturedSocket!.data!(mockSocket!, Buffer.from("x"), 1234, "1.2.3.4"),
      ).not.toThrow();
      await flushPromises();
    });

    test("open hook error is caught", async () => {
      const router = new UDPRouter();
      router.udp("svc", {
        open: () => {
          throw new Error("open hook fail");
        },
      });
      const runtime = createRuntime();
      await expect(
        router.listen(runtime, "svc", { port: 0 }),
      ).resolves.toBeDefined();
      await flushPromises();
    });

    test("connect open hook error is caught", async () => {
      const router = new UDPRouter();
      router.udp("client", {
        open: () => {
          throw new Error("connect open fail");
        },
      });
      const runtime = createRuntime();
      await expect(
        router.connect(runtime, "client", {
          hostname: "127.0.0.1",
          port: 9999,
        }),
      ).resolves.toBeDefined();
      await flushPromises();
    });

    test("connect data hook error is caught", async () => {
      const router = new UDPRouter();
      router.udp("client", {
        data: () => {
          throw new Error("connect data fail");
        },
      });
      const runtime = createRuntime();
      await router.connect(runtime, "client", {
        hostname: "127.0.0.1",
        port: 9999,
      });
      expect(() =>
        capturedSocket!.data!(mockSocket!, Buffer.from("x"), 1234, "1.2.3.4"),
      ).not.toThrow();
      await flushPromises();
    });
  });

  // ─── ctx.stop() prevents hook ────────────────────────────

  describe("ctx.stop() prevents hook", () => {
    test("bus listener stops ctx, hook not called", async () => {
      const router = new UDPRouter();
      let hookCalled = false;
      router.udp("svc", {
        data: () => {
          hookCalled = true;
        },
      });
      const bus = new EventBus();
      bus.on("udp:data", (ctx: Context) => {
        ctx.stop();
      });
      const runtime = createRuntime({ bus });
      await router.listen(runtime, "svc", { port: 0 });
      capturedSocket!.data!(mockSocket!, Buffer.from("x"), 1234, "1.2.3.4");
      await flushPromises();
      expect(hookCalled).toBe(false);
    });
  });

  // ─── stop() ──────────────────────────────────────────────

  describe("stop()", () => {
    test("closes all sockets and triggers close hook", async () => {
      const router = new UDPRouter();
      let closeHookCalled = false;
      router.udp("svc", {
        close: () => {
          closeHookCalled = true;
        },
      });
      const runtime = createRuntime();
      const sock = await router.listen(runtime, "svc", { port: 0 });
      await flushPromises();
      router.stop(runtime);
      await flushPromises();
      expect(closeHookCalled).toBe(true);
      expect(sock.close).toHaveBeenCalled();
    });

    test("does not close already-closed sockets", async () => {
      const router = new UDPRouter();
      router.udp("svc", { close: () => {} });
      const runtime = createRuntime();
      const sock = await router.listen(runtime, "svc", { port: 0 });
      await flushPromises();
      // Mark socket as already closed
      (sock as unknown as { closed: boolean }).closed = true;
      const closeMock = sock.close as ReturnType<typeof mock>;
      closeMock.mockClear();
      router.stop(runtime);
      await flushPromises();
      expect(closeMock).not.toHaveBeenCalled();
    });

    test("clears sockets array", async () => {
      const router = new UDPRouter();
      router.udp("svc", { open: () => {} });
      const runtime = createRuntime();
      await router.listen(runtime, "svc", { port: 0 });
      await flushPromises();
      router.stop(runtime);
      // Calling stop again should be safe — no sockets to close
      expect(() => router.stop(runtime)).not.toThrow();
    });

    test("stop with no sockets is safe", () => {
      const router = new UDPRouter();
      const runtime = createRuntime();
      expect(() => router.stop(runtime)).not.toThrow();
    });

    test("stop triggers close hook with correct name", async () => {
      const router = new UDPRouter();
      let receivedName: string | undefined;
      router.udp("svc1", {
        close: (ctx) => {
          receivedName = ctx.udpName;
        },
      });
      const runtime = createRuntime();
      await router.listen(runtime, "svc1", { port: 0 });
      await flushPromises();
      router.stop(runtime);
      await flushPromises();
      expect(receivedName).toBe("svc1");
    });
  });

  // ─── Async hooks ─────────────────────────────────────────

  describe("async hooks", () => {
    test("async open hook is awaited", async () => {
      const router = new UDPRouter();
      let hookCompleted = false;
      router.udp("svc", {
        open: async () => {
          await new Promise((r) => setTimeout(r, 5));
          hookCompleted = true;
        },
      });
      const runtime = createRuntime();
      await router.listen(runtime, "svc", { port: 0 });
      await flushPromises();
      expect(hookCompleted).toBe(true);
    });

    test("async data hook is awaited", async () => {
      const router = new UDPRouter();
      let hookCompleted = false;
      router.udp("svc", {
        data: async () => {
          await new Promise((r) => setTimeout(r, 5));
          hookCompleted = true;
        },
      });
      const runtime = createRuntime();
      await router.listen(runtime, "svc", { port: 0 });
      capturedSocket!.data!(mockSocket!, Buffer.from("x"), 1234, "1.2.3.4");
      await flushPromises();
      expect(hookCompleted).toBe(true);
    });

    test("async close hook on stop is awaited", async () => {
      const router = new UDPRouter();
      let hookCompleted = false;
      router.udp("svc", {
        close: async () => {
          await new Promise((r) => setTimeout(r, 5));
          hookCompleted = true;
        },
      });
      const runtime = createRuntime();
      await router.listen(runtime, "svc", { port: 0 });
      await flushPromises();
      router.stop(runtime);
      await flushPromises();
      expect(hookCompleted).toBe(true);
    });
  });

  // ─── Multiple sockets ────────────────────────────────────

  describe("multiple sockets", () => {
    test("stop closes all sockets", async () => {
      const router = new UDPRouter();
      router.udp("svc1", { open: () => {} });
      router.udp("svc2", { open: () => {} });
      const runtime = createRuntime();
      const sock1 = await router.listen(runtime, "svc1", { port: 0 });
      const sock2 = await router.listen(runtime, "svc2", { port: 0 });
      await flushPromises();
      const closeMock1 = sock1.close as ReturnType<typeof mock>;
      const closeMock2 = sock2.close as ReturnType<typeof mock>;
      router.stop(runtime);
      await flushPromises();
      expect(closeMock1).toHaveBeenCalled();
      expect(closeMock2).toHaveBeenCalled();
    });
  });
});
