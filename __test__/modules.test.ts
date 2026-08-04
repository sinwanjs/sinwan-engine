import { describe, expect, test, mock, beforeEach } from "bun:test";
import {
  createPlugin,
  createHttpModule,
  createWSModule,
  createTCPModule,
  createUDPModule,
  createGRPCModule,
  type SinwanModule,
  type HTTPRouterFluent,
} from "../src/modules";
import { HTTPRouter } from "../src/routers/http-router";
import { LifecycleState } from "../src/types";
import type { Sinwan } from "../src/sinwan";
import type { Runtime } from "../src/runtime";
import type { Context } from "../src/context/context";
import type { EventBus } from "../src/event-bus";
import type { ErrorHandler } from "../src/error-handler";
import {
  registerGRPCProvider,
  resetGRPCProvider,
  type GRPCProvider,
} from "../src/context/helpers/grpc-provider";

function createMockApp(): Sinwan {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    runtime: {} as Runtime,
    lifecycle: {
      state: LifecycleState.INIT,
      on: () => ({}),
      off: () => ({}),
      once: () => ({}),
      init: async () => {},
      ready: async () => {},
      shutdown: async () => {},
      destroy: async () => {},
      getState: () => LifecycleState.INIT,
      is: () => true,
      can: () => true,
      assert: () => {},
    },
    bus: {} as EventBus,
    get(path: string, ...handlers: unknown[]) {
      calls.push({ method: "get", args: [path, ...handlers] });
    },
    post(path: string, ...handlers: unknown[]) {
      calls.push({ method: "post", args: [path, ...handlers] });
    },
    put(path: string, ...handlers: unknown[]) {
      calls.push({ method: "put", args: [path, ...handlers] });
    },
    patch(path: string, ...handlers: unknown[]) {
      calls.push({ method: "patch", args: [path, ...handlers] });
    },
    delete(path: string, ...handlers: unknown[]) {
      calls.push({ method: "delete", args: [path, ...handlers] });
    },
    options(path: string, ...handlers: unknown[]) {
      calls.push({ method: "options", args: [path, ...handlers] });
    },
    head(path: string, ...handlers: unknown[]) {
      calls.push({ method: "head", args: [path, ...handlers] });
    },
    all(path: string, ...handlers: unknown[]) {
      calls.push({ method: "all", args: [path, ...handlers] });
    },
    use(..._handlers: unknown[]) {},
    static(prefix: string, root: string) {
      calls.push({ method: "static", args: [prefix, root] });
    },
    ws(path: string, config: unknown) {
      calls.push({ method: "ws", args: [path, config] });
    },
    tcp(name: string, config: unknown) {
      calls.push({ method: "tcp", args: [name, config] });
    },
    udp(name: string, config: unknown) {
      calls.push({ method: "udp", args: [name, config] });
    },
    grpc(name: string, config: unknown) {
      calls.push({ method: "grpc", args: [name, config] });
    },
    install: () => ({}),
    register: (...modules: SinwanModule[]) => {
      for (const m of modules) {
        if ("type" in m && (m as { type?: string }).type === "http") {
          (m.register as (app: Sinwan, router: HTTPRouter) => void)(
            mockApp,
            mockHttpRouter,
          );
        } else {
          m.register(mockApp);
        }
      }
    },
    request: () => new Response(),
    listen: async () => ({}),
    listenTCP: async () => ({}),
    connectTCP: async () => ({}),
    listenUDP: async () => ({}),
    connectUDP: async () => ({}),
    listenGRPC: async () => ({}),
    connectGRPC: () => ({}),
    stop: async () => {},
    _calls: calls,
  } as unknown as Sinwan & { _calls: { method: string; args: unknown[] }[] };
}

const mockHttpRouter = new HTTPRouter();
const mockApp = createMockApp();

function createMockProvider(): GRPCProvider {
  return {
    registerService: mock(() => {}),
    listen: async () => ({}),
    connect: () => ({}),
    stop: async () => {},
  };
}

const noopHandler = (): void => {};

describe("modules", () => {
  beforeEach(() => {
    resetGRPCProvider();
  });

  // ─── createPlugin ────────────────────────────────────────

  describe("createPlugin", () => {
    test("creates plugin from config object", () => {
      const install = (): void => {};
      const plugin = createPlugin({ name: "my-plugin", install });
      expect(plugin.name).toBe("my-plugin");
      expect(plugin.install).toBe(install);
    });

    test("creates plugin from name and install arguments", () => {
      const install = (): void => {};
      const plugin = createPlugin("my-plugin", install);
      expect(plugin.name).toBe("my-plugin");
      expect(plugin.install).toBe(install);
    });
  });

  // ─── createHttpModule ────────────────────────────────────

  describe("createHttpModule", () => {
    test("creates module with prefix", () => {
      const mod = createHttpModule({
        prefix: "/api",
        routes: (router) => {
          router.get("/users", noopHandler);
        },
      });
      expect(mod.type).toBe("http");
      expect(mod.name).toBe("http:/api");
      expect(mod.prefix).toBe("/api");
    });

    test("creates module with description", () => {
      const mod = createHttpModule({
        prefix: "/api",
        description: "API Module",
        routes: () => {},
      });
      expect(mod.name).toBe("API Module");
    });

    test("creates module without prefix (root-level)", () => {
      const mod = createHttpModule({
        routes: () => {},
      });
      expect(mod.type).toBe("http");
      expect(mod.name).toBe("http:/");
      expect(mod.prefix).toBeUndefined();
    });

    test("register without httpRouter throws TypeError", () => {
      const app = createMockApp();
      const mod = createHttpModule({
        prefix: "/api",
        routes: () => {},
      });
      expect(() => mod.register(app)).toThrow(TypeError);
      expect(() => mod.register(app)).toThrow(/HTTPRouter/);
    });

    test("register with prefix calls httpRouter.group", () => {
      const app = createMockApp();
      const httpRouter = new HTTPRouter();
      const mod = createHttpModule({
        prefix: "/api",
        routes: (router) => {
          router.get("/users", noopHandler);
        },
      });
      mod.register(app, httpRouter);
      // group() mounts child routes into the parent router
      expect(httpRouter.getRoutes().length).toBe(1);
    });

    test("register without prefix calls httpRouter.mount", () => {
      const app = createMockApp();
      const httpRouter = new HTTPRouter();
      const mod = createHttpModule({
        routes: (router) => {
          router.get("/users", noopHandler);
        },
      });
      mod.register(app, httpRouter);
      // mount("/", tempRouter) merges temp routes into the parent router
      expect(httpRouter.getRoutes().length).toBe(1);
    });
  });

  // ─── HTTPRouterFluent ────────────────────────────────────

  describe("HTTPRouterFluent", () => {
    test("get returns void", () => {
      const router = new HTTPRouter();
      const fluent = createHttpModule({
        prefix: "/test",
        routes: (r) => {
          const result = r.get("/foo", noopHandler);
          expect(result).toBeUndefined();
        },
      });
      // Just verify it doesn't throw
      expect(fluent).toBeDefined();
    });

    test("all HTTP methods return void", () => {
      const mod = createHttpModule({
        prefix: "/test",
        routes: (r) => {
          expect(r.get("/g", noopHandler)).toBeUndefined();
          expect(r.post("/p", noopHandler)).toBeUndefined();
          expect(r.put("/pu", noopHandler)).toBeUndefined();
          expect(r.patch("/pa", noopHandler)).toBeUndefined();
          expect(r.delete("/d", noopHandler)).toBeUndefined();
          expect(r.options("/o", noopHandler)).toBeUndefined();
          expect(r.head("/h", noopHandler)).toBeUndefined();
          expect(r.all("/a", noopHandler)).toBeUndefined();
        },
      });
      expect(mod).toBeDefined();
    });

    test("use returns void", () => {
      const mod = createHttpModule({
        prefix: "/test",
        routes: (r) => {
          expect(r.use(noopHandler)).toBeUndefined();
        },
      });
      expect(mod).toBeDefined();
    });

    test("group returns void", () => {
      const mod = createHttpModule({
        prefix: "/test",
        routes: (r) => {
          const result = r.group("/sub", (child) => {
            child.get("/foo", noopHandler);
          });
          expect(result).toBeUndefined();
        },
      });
      expect(mod).toBeDefined();
    });

    test("mount returns void", () => {
      const otherRouter = new HTTPRouter();
      const mod = createHttpModule({
        prefix: "/test",
        routes: (r) => {
          expect(r.mount("/mounted", otherRouter)).toBeUndefined();
        },
      });
      expect(mod).toBeDefined();
    });

    test("static returns void", () => {
      const mod = createHttpModule({
        prefix: "/test",
        routes: (r) => {
          expect(r.static("/public", "./public")).toBeUndefined();
        },
      });
      expect(mod).toBeDefined();
    });

    test("fluent router actually registers routes on the HTTPRouter", () => {
      const mod = createHttpModule({
        routes: (r) => {
          r.get("/a", noopHandler);
          r.post("/b", noopHandler);
          r.put("/c", noopHandler);
          r.patch("/d", noopHandler);
          r.delete("/e", noopHandler);
          r.options("/f", noopHandler);
          r.head("/g", noopHandler);
          r.all("/h", noopHandler);
        },
      });
      const app = createMockApp();
      const httpRouter = new HTTPRouter();
      mod.register(app, httpRouter);
      // mount("/", tempRouter) merges all 8 routes into the parent router
      expect(httpRouter.getRoutes().length).toBe(8);
    });

    test("fluent router use adds middleware", () => {
      const mod = createHttpModule({
        routes: (r) => {
          r.use(noopHandler);
          r.use(noopHandler);
        },
      });
      const app = createMockApp();
      const httpRouter = new HTTPRouter();
      mod.register(app, httpRouter);
      // use doesn't add routes, it adds middleware
      expect(httpRouter.getRoutes().length).toBe(0);
    });

    test("fluent router group creates sub-routes", () => {
      const mod = createHttpModule({
        routes: (r) => {
          r.group("/sub", (child) => {
            child.get("/foo", noopHandler);
            child.post("/bar", noopHandler);
          });
        },
      });
      const app = createMockApp();
      const httpRouter = new HTTPRouter();
      mod.register(app, httpRouter);
      // group mounts child routes into the parent router
      expect(httpRouter.getRoutes().length).toBe(2);
    });

    test("fluent router mount adds routes from another router", () => {
      const other = new HTTPRouter();
      other.get("/nested", noopHandler);
      const mod = createHttpModule({
        routes: (r) => {
          r.mount("/mounted", other);
        },
      });
      const app = createMockApp();
      const httpRouter = new HTTPRouter();
      mod.register(app, httpRouter);
      // mount("/", tempRouter) merges temp routes (which include the nested
      // mount) into the parent router — the nested route is prefixed and
      // added as a single route
      expect(httpRouter.getRoutes().length).toBe(1);
    });

    test("fluent router static registers a static route", () => {
      const mod = createHttpModule({
        routes: (r) => {
          r.static("/public", "./public");
        },
      });
      const app = createMockApp();
      const httpRouter = new HTTPRouter();
      mod.register(app, httpRouter);
      expect(httpRouter.getRoutes().length).toBe(1);
    });
  });

  // ─── createWSModule ──────────────────────────────────────

  describe("createWSModule", () => {
    test("creates module with path and config", () => {
      const wsConfig = { open: () => {} };
      const mod = createWSModule({
        path: "/chat",
        config: wsConfig,
      });
      expect(mod.type).toBe("ws");
      expect(mod.name).toBe("ws:/chat");
      expect(mod.path).toBe("/chat");
    });

    test("creates module with description", () => {
      const mod = createWSModule({
        path: "/chat",
        config: { open: () => {} },
        description: "Chat Module",
      });
      expect(mod.name).toBe("Chat Module");
    });

    test("register calls app.ws", () => {
      const app = createMockApp();
      const wsConfig = { open: () => {} };
      const mod = createWSModule({
        path: "/chat",
        config: wsConfig,
      });
      mod.register(app);
      const calls = (
        app as unknown as { _calls: { method: string; args: unknown[] }[] }
      )._calls;
      const wsCall = calls.find((c) => c.method === "ws");
      expect(wsCall).toBeDefined();
      expect(wsCall!.args[0]).toBe("/chat");
      expect(wsCall!.args[1]).toBe(wsConfig);
    });
  });

  // ─── createTCPModule ─────────────────────────────────────

  describe("createTCPModule", () => {
    test("creates module with name and config", () => {
      const tcpConfig = { open: () => {} };
      const mod = createTCPModule({
        name: "my-tcp",
        config: tcpConfig,
      });
      expect(mod.type).toBe("tcp");
      expect(mod.name).toBe("tcp:my-tcp");
    });

    test("creates module with description", () => {
      const mod = createTCPModule({
        name: "my-tcp",
        config: { open: () => {} },
        description: "TCP Module",
      });
      expect(mod.name).toBe("TCP Module");
    });

    test("register calls app.tcp", () => {
      const app = createMockApp();
      const tcpConfig = { open: () => {} };
      const mod = createTCPModule({
        name: "my-tcp",
        config: tcpConfig,
      });
      mod.register(app);
      const calls = (
        app as unknown as { _calls: { method: string; args: unknown[] }[] }
      )._calls;
      const tcpCall = calls.find((c) => c.method === "tcp");
      expect(tcpCall).toBeDefined();
      expect(tcpCall!.args[0]).toBe("my-tcp");
      expect(tcpCall!.args[1]).toBe(tcpConfig);
    });
  });

  // ─── createUDPModule ─────────────────────────────────────

  describe("createUDPModule", () => {
    test("creates module with name and config", () => {
      const udpConfig = { open: () => {} };
      const mod = createUDPModule({
        name: "my-udp",
        config: udpConfig,
      });
      expect(mod.type).toBe("udp");
      expect(mod.name).toBe("udp:my-udp");
    });

    test("creates module with description", () => {
      const mod = createUDPModule({
        name: "my-udp",
        config: { open: () => {} },
        description: "UDP Module",
      });
      expect(mod.name).toBe("UDP Module");
    });

    test("register calls app.udp", () => {
      const app = createMockApp();
      const udpConfig = { open: () => {} };
      const mod = createUDPModule({
        name: "my-udp",
        config: udpConfig,
      });
      mod.register(app);
      const calls = (
        app as unknown as { _calls: { method: string; args: unknown[] }[] }
      )._calls;
      const udpCall = calls.find((c) => c.method === "udp");
      expect(udpCall).toBeDefined();
      expect(udpCall!.args[0]).toBe("my-udp");
      expect(udpCall!.args[1]).toBe(udpConfig);
    });
  });

  // ─── createGRPCModule ────────────────────────────────────

  describe("createGRPCModule", () => {
    test("creates module with name and config", () => {
      const mod = createGRPCModule({
        name: "MyService",
        config: { method: "ping" },
      });
      expect(mod.type).toBe("grpc");
      expect(mod.name).toBe("grpc:MyService");
    });

    test("creates module with description", () => {
      const mod = createGRPCModule({
        name: "MyService",
        config: {},
        description: "gRPC Module",
      });
      expect(mod.name).toBe("gRPC Module");
    });

    test("register calls provider.registerService", () => {
      const provider = createMockProvider();
      registerGRPCProvider(provider);
      const grpcConfig = { method: "ping" };
      const mod = createGRPCModule({
        name: "MyService",
        config: grpcConfig,
      });
      mod.register({} as Sinwan);
      expect(provider.registerService).toHaveBeenCalledWith(
        "MyService",
        grpcConfig,
      );
    });
  });

  // ─── SinwanModule interface conformance ──────────────────

  describe("SinwanModule interface conformance", () => {
    test("all modules have name and register", () => {
      const httpMod = createHttpModule({ routes: () => {} });
      const wsMod = createWSModule({ path: "/ws", config: { open: () => {} } });
      const tcpMod = createTCPModule({
        name: "tcp",
        config: { open: () => {} },
      });
      const udpMod = createUDPModule({
        name: "udp",
        config: { open: () => {} },
      });
      const grpcMod = createGRPCModule({ name: "grpc", config: {} });

      for (const mod of [httpMod, wsMod, tcpMod, udpMod, grpcMod]) {
        expect(typeof mod.name).toBe("string");
        expect(typeof mod.register).toBe("function");
      }
    });
  });
});
