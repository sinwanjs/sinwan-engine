import { StepEngine } from "./step-engine";
import { EventBus } from "./event-bus";
import {
  ErrorHandler,
  type ErrorHandlerOptions,
  type ErrorHook,
} from "./error-handler";
import { Runtime } from "./runtime";
import { HTTPRouter, type RouteHandler } from "./routers/http-router";
import {
  WSRouter,
  type WSRouteConfig,
  type WSOptions,
} from "./routers/ws-router";
import {
  TCPRouter,
  type TCPClientConfig,
  type TCPConnectOptions,
  type TCPHook,
  type TCPListenOptions,
  type TCPRouteConfig,
} from "./routers/tcp-router";
import {
  UDPRouter,
  type UDPConnectOptions,
  type UDPHook,
  type UDPListenOptions,
  type UDPRouteConfig,
} from "./routers/udp-router";
import { getGRPCProvider, hasGRPCProvider } from "./context/grpc-provider";
import { LifecycleManager } from "./lifecycle-manager";
import { InternalAssets, type InternalAssetsOptions } from "./internal-assets";
import type {
  Server,
  Socket,
  TCPSocketListener,
  UnixSocketListener,
} from "bun";
import type { EventHandler, Plugin, Request, Step } from "./types";
import { LifecycleState } from "./types";
import type { SinwanModule } from "./modules";
import type { Context } from "./context/context";

export interface SinwanOptions {
  idleTimeout?: number;
  /** Maximum number of contexts to keep in the pool. Default: 1000 */
  maxPoolSize?: number;
  /** WebSocket server-level options (compression, limits, etc). */
  websocket?: WSOptions;
  /** Error handler options. */
  error?: ErrorHandlerOptions;
  /** Internal assets handler options (favicon, robots.txt, etc). */
  internalAssets?: InternalAssetsOptions;
}

export class Sinwan {
  /** Lifecycle Manager: Manages the application lifecycle.*/
  public readonly lifecycle: LifecycleManager = new LifecycleManager();

  /** Event Bus: Handles events for the application.*/
  public readonly bus: EventBus;

  /** Step Engine: Executes steps in order.*/
  /** Each step is a function that takes the context and returns a Promise.*/
  private readonly engine: StepEngine;

  /** Router: Handles routing for the application.*/
  private readonly httpRouter: HTTPRouter;

  /** WS Router: Handles WebSocket route registration and upgrade dispatch.*/
  private readonly wsRouter: WSRouter;

  /** TCP Router: Handles TCP route registration and Bun TCP server dispatch.*/
  private readonly tcpRouter: TCPRouter;

  /** UDP Router: Handles UDP route registration and socket dispatch.*/
  private readonly udpRouter: UDPRouter;

  /** Runtime: Handles the runtime for the application.*/
  private readonly runtime: Runtime;

  /** Error Handler: Handles errors for the application.*/
  private readonly errorHandler: ErrorHandler;

  /** Internal Assets: Handles static asset paths (favicon, robots.txt, etc). */
  public readonly internalAssets: InternalAssets;

  /** Shared State: Manages the shared state for the application.*/
  private readonly sharedState = new Map<string, unknown>();

  /** Config: Manages the configuration for the application.*/
  private readonly config: SinwanOptions;

  /** Server: Manages the server for the application.*/
  private server?: Server<unknown>;

  /** HTTP Router Installed: Tracks if the HTTP router has been installed.*/
  private httpRouterInstalled = false;

  /**
   * Create a new SinwanJS application.
   *
   * The constructor is **fully synchronous** — it only allocates memory and
   * wires up internal systems.  No I/O, no async work, no thrown exceptions.
   *
   * If you need to run async setup hooks (plugins, DB connections, etc.),
   * use the {@link Sinwan.create} factory instead.
   *
   * @param options Configuration options for the application.
   * @param options.idleTimeout Optional idle timeout in milliseconds.
   * @param options.maxPoolSize Maximum context pool size (default: 1000).
   * @param options.error Error handler options. If not provided, default error handling will be used.
   */
  constructor(options: SinwanOptions = {}) {
    this.config = options;
    this.engine = new StepEngine();
    this.bus = new EventBus();
    this.errorHandler = new ErrorHandler(options.error ?? {});
    this.httpRouter = new HTTPRouter();
    this.wsRouter = new WSRouter();
    this.tcpRouter = new TCPRouter();
    this.udpRouter = new UDPRouter();
    this.internalAssets = new InternalAssets(options.internalAssets ?? {});

    this.runtime = new Runtime({
      engine: this.engine,
      bus: this.bus,
      errorHandler: this.errorHandler,
      globalState: this.sharedState,
      maxPoolSize: options.maxPoolSize,
    });

    // Only install internal assets step when explicitly configured
    if (options.internalAssets) {
      this.runtime.use(this.internalAssets);
    }

    if (options.websocket) {
      this.wsRouter.setOptions(options.websocket);
    }
  }

  /**
   * Install one or more plugins.
   *
   * ```ts
   * app
   *   .install(loggerPlugin)
   *   .install(authPlugin, corsPlugin, rateLimitPlugin)
   *   .install({
   *     name: "hello",
   *     install(rt) { rt.bus.on("init", () => console.log("Hello!")); }
   *   });
   * ```
   *
   * @param plugins One or more Plugin instances.
   * @returns `this` for fluent chaining.
   */
  install(...plugins: Plugin[]): this {
    for (const plugin of plugins) {
      if (!plugin || typeof plugin !== "object") {
        throw new TypeError(
          `[Sinwan.install] Expected a Plugin object, got ${typeof plugin}.`,
        );
      }
      if (typeof plugin.name !== "string" || !plugin.name) {
        throw new TypeError(
          `[Sinwan.install] Plugin must have a non-empty string "name".`,
        );
      }
      if (typeof plugin.install !== "function") {
        throw new TypeError(
          `[Sinwan.install] Plugin "${plugin.name}" must have an "install(rt: Runtime)" method.`,
        );
      }
      this.runtime.use(plugin);
    }
    return this;
  }

  /**
   * Add a middleware step to the request pipeline.
   *
   * **Named step (explicit):**
   * ```ts
   * app.add("auth", async (ctx, bus) => {
   *   const token = ctx.req.headers.get("authorization");
   *   if (!token) return { type: "stop" };
   *   ctx.set("user", await verify(token));
   * });
   * ```
   *
   * **Full Step object:**
   * ```ts
   * app.add({
   *   name: "cors",
   *   async run(ctx) {
   *     ctx.res.headers.set("Access-Control-Allow-Origin", "*");
   *   },
   * });
   * ```
   *
   * Steps execute in registration order. Duplicate names throw.
   *
   * @returns `this` for fluent chaining.
   */
  add(step: Step): this;
  add(name: string, run: Step["run"]): this;
  add(stepOrName: Step | string, run?: Step["run"]): this {
    if (typeof stepOrName === "string") {
      if (!stepOrName) {
        throw new TypeError(`[Sinwan.add] Step name cannot be empty.`);
      }
      if (typeof run !== "function") {
        throw new TypeError(
          `[Sinwan.add] Second argument must be a function for step "${stepOrName}".`,
        );
      }
      this.engine.add({ name: stepOrName, run });
    } else {
      if (!stepOrName || typeof stepOrName !== "object") {
        throw new TypeError(`[Sinwan.add] Expected a Step object.`);
      }
      if (typeof stepOrName.name !== "string" || !stepOrName.name) {
        throw new TypeError(
          `[Sinwan.add] Step must have a non-empty string "name".`,
        );
      }
      if (typeof stepOrName.run !== "function") {
        throw new TypeError(
          `[Sinwan.add] Step "${stepOrName.name}" must have a "run" method.`,
        );
      }
      this.engine.add(stepOrName);
    }
    return this;
  }

  /**
   * Register one or more modules or capability providers.
   *
   * Modules define protocol routes (HTTP, WS, TCP, UDP, gRPC).
   * Providers plug external functionality (gRPC, etc.)
   * into the engine without bundling their dependencies.
   *
   * ```ts
   * import { createHttpModule } from "sinwan-engine";
   * import { sinwanGRPC } from "sinwan-grpc";
   *
   * const apiModule = createHttpModule({
   *   prefix: "/api",
   *   routes: (app) => app.get("/users", listUsers),
   * });
   *
   * const app = new Sinwan();
   * app.register(apiModule, sinwanGRPC);
   * ```
   *
   * @returns `this` for fluent chaining.
   */
  register(...modules: SinwanModule[]): this {
    for (const mod of modules) {
      if (!mod || typeof mod !== "object") {
        throw new TypeError(
          `[Sinwan.register] Expected a module object, got ${typeof mod}.`,
        );
      }
      if (typeof mod.name !== "string" || !mod.name) {
        throw new TypeError(
          `[Sinwan.register] Module must have a non-empty string "name".`,
        );
      }
      if (typeof mod.register !== "function") {
        throw new TypeError(
          `[Sinwan.register] Module "${mod.name}" must have a "register(app)" method.`,
        );
      }
      mod.register(this);
    }
    return this;
  }

  /**
   * Factory that creates a Sinwan app **and** runs the async `init` lifecycle.
   *
   * ```ts
   * const app = await Sinwan.create({
   *   maxPoolSize: 500,
   *   error: { responseType: "json" },
   * });
   *
   * app.get("/", (ctx) => ctx.json({ hello: "world" }));
   * app.listen(3000);
   * ```
   *
   * @param options Same options as the constructor.
   * @returns A ready-to-use Sinwan instance.
   */
  static async create(options: SinwanOptions = {}): Promise<Sinwan> {
    const app = new Sinwan(options);
    if (app.lifecycle.getState() === LifecycleState.IDLE) {
      await app.lifecycle.init({ options });
    }
    return app;
  }

  /**
   * Register a GET route handler.
   *
   * ```ts
   * app
   *   .get("/", (ctx) => ctx.json({ hello: "world" }))
   *   .get("/users/:id", (ctx) => ctx.json({ id: ctx.params.id }));
   * ```
   *
   * @returns `this` for fluent chaining.
   */
  get(path: string, ...handlers: RouteHandler[]): this {
    this.validateRoute("GET", path, handlers);
    this.httpRouter.get(path, ...handlers);
    return this;
  }

  /**
   * Register a POST route handler.
   *
   * ```ts
   * app.post("/users", async (ctx) => {
   *   const body = await ctx.req.json();
   *   ctx.json({ created: body });
   * });
   * ```
   *
   * @returns `this` for fluent chaining.
   */
  post(path: string, ...handlers: RouteHandler[]): this {
    this.validateRoute("POST", path, handlers);
    this.httpRouter.post(path, ...handlers);
    return this;
  }

  /**
   * Register a PUT route handler.
   * @returns `this` for fluent chaining.
   */
  put(path: string, ...handlers: RouteHandler[]): this {
    this.validateRoute("PUT", path, handlers);
    this.httpRouter.put(path, ...handlers);
    return this;
  }

  /**
   * Register a PATCH route handler.
   * @returns `this` for fluent chaining.
   */
  patch(path: string, ...handlers: RouteHandler[]): this {
    this.validateRoute("PATCH", path, handlers);
    this.httpRouter.patch(path, ...handlers);
    return this;
  }

  /**
   * Register a DELETE route handler.
   * @returns `this` for fluent chaining.
   */
  delete(path: string, ...handlers: RouteHandler[]): this {
    this.validateRoute("DELETE", path, handlers);
    this.httpRouter.delete(path, ...handlers);
    return this;
  }

  /**
   * Register an OPTIONS route handler.
   * @returns `this` for fluent chaining.
   */
  options(path: string, ...handlers: RouteHandler[]): this {
    this.validateRoute("OPTIONS", path, handlers);
    this.httpRouter.options(path, ...handlers);
    return this;
  }

  /**
   * Register a HEAD route handler.
   * @returns `this` for fluent chaining.
   */
  head(path: string, ...handlers: RouteHandler[]): this {
    this.validateRoute("HEAD", path, handlers);
    this.httpRouter.head(path, ...handlers);
    return this;
  }

  /**
   * Register a catch-all route for every HTTP method.
   *
   * ```ts
   * app.all("/health", (ctx) => ctx.json({ status: "ok" }));
   * ```
   *
   * @returns `this` for fluent chaining.
   */
  all(path: string, ...handlers: RouteHandler[]): this {
    this.validateRoute("ALL", path, handlers);
    this.httpRouter.all(path, ...handlers);
    return this;
  }

  /**
   * Register a WebSocket route.
   *
   * ```ts
   * app.ws<{ userId: string }>("/chat", {
   *   upgrade(ctx) {
   *     ctx.set("ws:data", { userId: ctx.req.headers.get("x-user-id") });
   *   },
   *   open(ws) { ws.subscribe("room:1"); },
   *   message(ws, msg) { ws.publish("room:1", msg); },
   *   close(ws) { ws.unsubscribe("room:1"); },
   * });
   * ```
   *
   * @returns `this` for fluent chaining.
   */
  ws(path: string, config: WSRouteConfig): this {
    if (!path || typeof path !== "string") {
      throw new TypeError(`[Sinwan.ws] Path must be a non-empty string.`);
    }
    this.wsRouter.ws(path, config);
    return this;
  }

  /**
   * Register a TCP route.
   * @returns `this` for fluent chaining.
   */
  tcp(name: string, config: TCPRouteConfig): this {
    if (!name || typeof name !== "string") {
      throw new TypeError(`[Sinwan.tcp] Name must be a non-empty string.`);
    }
    this.tcpRouter.tcp(name, config);
    return this;
  }

  /**
   * Register a UDP route.
   * @returns `this` for fluent chaining.
   */
  udp(name: string, config: UDPRouteConfig): this {
    if (!name || typeof name !== "string") {
      throw new TypeError(`[Sinwan.udp] Name must be a non-empty string.`);
    }
    this.udpRouter.udp(name, config);
    return this;
  }

  /**
   * Register a gRPC service route.
   *
   * When `sinwan-grpc` is installed, this method is augmented with
   * a fully typed overload (`GRPCServiceConfig`).
   *
   * ```ts
   * app.grpc("greeter", {
   *   proto: "./proto/greeter.proto",
   *   package: "hello.v1",
   *   service: "Greeter",
   *   methods: {
   *     SayHello: (ctx, request) => ({ message: `Hello ${request.name}` }),
   *   },
   * });
   *
   * await app.listenGRPC({ port: 50051 });
   * ```
   *
   * @returns `this` for fluent chaining.
   */
  grpc(name: string, config: never): this;
  grpc(name: string, config: unknown): this {
    if (!name || typeof name !== "string") {
      throw new TypeError(`[Sinwan.grpc] Name must be a non-empty string.`);
    }
    getGRPCProvider().registerService(name, config);
    return this;
  }

  /**
   * Register a middleware hook for TCP events.
   * Runs before the route's own handler.
   * @returns `this` for fluent chaining.
   */
  beforeTCP(
    event: "open" | "data" | "close" | "drain" | "error",
    handler: TCPHook,
  ): this {
    this.bus.on(`tcp:${event}`, handler);
    return this;
  }

  /**
   * Register a middleware hook for UDP events.
   * Runs before the route's own handler.
   * @returns `this` for fluent chaining.
   */
  beforeUDP(
    event: "open" | "data" | "drain" | "error" | "close",
    handler: UDPHook,
  ): this {
    this.bus.on(`udp:${event}`, handler);
    return this;
  }

  /**
   * Register a middleware hook for gRPC events.
   * Runs before the route's own handler for "call" events.
   *
   * When `sinwan-grpc` is installed, this method is augmented with
   * fully typed overloads (`GRPCHook`, `GRPCAfterHook`, `GRPCErrorHook`).
   *
   * @returns `this` for fluent chaining.
   */
  beforeGRPC(event: never, handler: never): this;
  beforeGRPC(
    event: "call" | "finish" | "error",
    handler: (ctx: unknown, ...args: unknown[]) => unknown,
  ): this {
    if (event === "error") {
      this.bus.on("grpc:error", (ctx, payload: unknown) =>
        handler(ctx, (payload as { error?: unknown })?.error, payload),
      );
      return this;
    }

    this.bus.on(`grpc:${event}`, handler as EventHandler);
    return this;
  }

  /**
   * Create a route group with a common prefix.
   *
   * ```ts
   * app.group("/api/v1", (r) => {
   *     r.get("/users", listUsers)
   *      .post("/users", createUser)
   *      .get("/posts", listPosts);
   *   });
   * ```
   *
   * @returns `this` for fluent chaining.
   */
  group(prefix: string, callback: (httpRouter: HTTPRouter) => void): this {
    if (!prefix || typeof prefix !== "string") {
      throw new TypeError(`[Sinwan.group] Prefix must be a non-empty string.`);
    }
    this.httpRouter.group(prefix, callback);
    return this;
  }

  /**
   * Mount an existing router instance under a prefix.
   *
   * ```ts
   * const apiRouter = new HTTPRouter();
   * apiRouter.get("/users", listUsers);
   * app.mount("/api", apiRouter);
   * ```
   *
   * @returns `this` for fluent chaining.
   */
  mount(prefix: string, httpRouter: HTTPRouter): this {
    if (!prefix || typeof prefix !== "string") {
      throw new TypeError(`[Sinwan.mount] Prefix must be a non-empty string.`);
    }
    this.httpRouter.mount(prefix, httpRouter);
    return this;
  }

  /**
   * Utility for testing and programmatic requests.
   * Send a mock request to the application.
   *
   * @param input A URL string, path, or a full Request object.
   * @param init Optional RequestInit options (method, headers, body, etc.).
   * @param server Optional mock Server object.
   * @returns A Promise resolving to a Response object.
   */
  request(
    input: globalThis.Request | string | URL,
    init?: RequestInit,
    server?: Server<unknown>,
  ): Response | Promise<Response> {
    if (input instanceof globalThis.Request) {
      if (init !== undefined) {
        input = new globalThis.Request(input, init);
      }
      this.ensureHttpRouterInstalled();
      return this.runtime.fetch(
        input as Request,
        server ?? ({} as Server<unknown>),
      );
    }

    // Support relative paths by providing a base URL
    const url =
      typeof input === "string" && input.startsWith("/")
        ? `http://localhost${input}`
        : input.toString();

    this.ensureHttpRouterInstalled();
    return this.runtime.fetch(
      new globalThis.Request(url, init) as Request,
      server ?? ({} as Server<unknown>),
    );
  }

  /**
   * Serve static files from a directory.
   *
   * ```ts
   * app.static("/public", "./public");
   * ```
   *
   * @param prefix The URL prefix (e.g. "/public")
   * @param root   The local directory path (e.g. "./public")
   * @returns `this` for fluent chaining.
   */
  static(prefix: string, root: string): this {
    if (!prefix || typeof prefix !== "string") {
      throw new TypeError(`[Sinwan.static] Prefix must be a non-empty string.`);
    }
    if (!root || typeof root !== "string") {
      throw new TypeError(`[Sinwan.static] Root must be a non-empty string.`);
    }
    this.httpRouter.static(prefix, root);
    return this;
  }

  listenTCP<T = unknown>(
    name: string,
    options: TCPListenOptions<T>,
  ): Promise<TCPSocketListener<unknown> | UnixSocketListener<unknown>> {
    this.assertInitialized("listenTCP");
    return this.transitionToReady(options.port ?? 0, "tcp").then(() => {
      return this.tcpRouter.listen(this.runtime, name, options) as
        | TCPSocketListener<unknown>
        | UnixSocketListener<unknown>;
    });
  }

  connectTCP<T = unknown>(
    name: string,
    options: TCPConnectOptions<T>,
    config: TCPClientConfig,
  ): Promise<Socket<unknown>> {
    return this.tcpRouter.connect(
      this.runtime,
      name,
      options,
      config,
    ) as Promise<Socket<unknown>>;
  }

  listenUDP<T = unknown>(
    name: string,
    options: UDPListenOptions<T>,
  ): Promise<import("./routers/udp-router").SinwanUDPSocket<T>> {
    this.assertInitialized("listenUDP");
    return this.transitionToReady(options.port ?? 0, "udp").then(() => {
      return this.udpRouter.listen(this.runtime, name, options);
    });
  }

  connectUDP<T = unknown>(
    name: string,
    options: UDPConnectOptions<T>,
  ): Promise<import("./routers/udp-router").SinwanUDPSocket<T>> {
    return this.udpRouter.connect(this.runtime, name, options);
  }

  /**
   * Start a gRPC server and listen for incoming calls.
   *
   * When `sinwan-grpc` is installed, this method is augmented with
   * fully typed overloads (`GRPCListenOptions` → `GRPCServerHandle`).
   *
   * ```ts
   * await app.listenGRPC({ port: 50051 });
   * ```
   */
  listenGRPC(nameOrOptions?: never, options?: never): Promise<never>;
  listenGRPC(
    nameOrOptions?: string | Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown> {
    const opts = typeof nameOrOptions === "string" ? options : nameOrOptions;
    const port = (opts?.port as number | string | undefined) ?? 50051;
    this.assertInitialized("listenGRPC");

    const provider = getGRPCProvider();
    const readyPromise = this.transitionToReady(port, "grpc");

    const handlePromise =
      typeof nameOrOptions === "string"
        ? provider.listen(this.runtime, nameOrOptions, options)
        : provider.listen(this.runtime, nameOrOptions);

    return readyPromise
      .then(() => handlePromise)
      .then((handle: unknown) => {
        this.lifecycle.on("shutdown", () => {
          (handle as { stop: () => void }).stop();
        });
        return handle;
      });
  }

  /**
   * Create a gRPC client to connect to a remote service.
   *
   * When `sinwan-grpc` is installed, this method is augmented with
   * a fully typed overload (`GRPCClientConfig` → `GRPCClient<S>`).
   *
   * ```ts
   * const client = app.connectGRPC({
   *   proto: "./proto/greeter.proto",
   *   package: "hello.v1",
   *   service: "Greeter",
   *   address: "localhost:50051",
   * });
   * ```
   */
  connectGRPC(config: never): unknown;
  connectGRPC(config: unknown): unknown {
    return getGRPCProvider().connect(config);
  }

  /**
   * Start the server and listen for incoming requests.
   *
   * ```ts
   * // Basic
   * await app.listen(3000);
   *
   * // With callback
   * await app.listen(3000, ({ port }) => {
   *   console.log(`Server live on http://localhost:${port}`);
   * });
   * ```
   *
   * @param port The port number to listen on.
   * @param callback Optional callback invoked after the server starts (receives `{ port, server }`).
   * @returns The Bun server instance.
   * @throws If the server fails to start or lifecycle transition fails.
   */
  async listen<WSData = unknown>(
    port: number | string = 3000,
    callback?: (info: {
      port: number | string;
      server: Server<WSData>;
    }) => void,
  ): Promise<Server<WSData>> {
    const hasHttpRoutes = this.httpRouterInstalled;
    this.ensureHttpRouterInstalled();

    // Install ws-upgrade step only when WS routes exist (zero cost otherwise)
    if (this.wsRouter.hasRoutes()) {
      this.runtime.use(this.wsRouter);
    }

    try {
      const wsHandlers = this.wsRouter.buildWebSocketHandlers(this.runtime);
      this.server = wsHandlers
        ? Bun.serve({
            port,
            idleTimeout: this.config.idleTimeout,
            fetch: (req, server) => this.runtime.fetch(req as Request, server),
            websocket: wsHandlers,
          })
        : Bun.serve({
            port,
            idleTimeout: this.config.idleTimeout,
            fetch: (req, server) => this.runtime.fetch(req as Request, server),
          });
    } catch (error) {
      throw new Error(
        `Failed to start server on port ${port}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    // Transition to READY phase (awaiting is critical for deterministic startup)
    try {
      await this.lifecycle.ready({
        port,
        server: this.server,
        protocol: this.wsRouter.hasRoutes() && !hasHttpRoutes ? "ws" : "http",
      });
    } catch (error) {
      // Server started but lifecycle failed - stop server and throw
      this.server.stop(true);
      this.server = undefined;
      throw new Error(
        `Failed to transition to ready state: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }

    if (callback) {
      try {
        callback({ port, server: this.server as Server<WSData> });
      } catch (error) {
        console.error("[Sinwan] Listen callback error:", error);
      }
    }

    return this.server as Server<WSData>;
  }

  /**
   * Validate route registration inputs.
   * @internal
   */
  private validateRoute(
    method: string,
    path: string,
    handlers: RouteHandler[],
  ): void {
    if (!path || typeof path !== "string") {
      throw new TypeError(
        `[Sinwan.${method}] Path must be a non-empty string.`,
      );
    }
    if (handlers.length === 0) {
      throw new TypeError(
        `[Sinwan.${method}] At least one handler is required for "${path}".`,
      );
    }
    for (let i = 0; i < handlers.length; i++) {
      if (typeof handlers[i] !== "function") {
        throw new TypeError(
          `[Sinwan.${method}] Handler at index ${i} must be a function.`,
        );
      }
    }
  }

  private ensureHttpRouterInstalled(): void {
    if (this.httpRouterInstalled) return;
    this.runtime.use(this.httpRouter);
    this.httpRouterInstalled = true;
  }

  /**
   * Assert that Sinwan.create() has been called (lifecycle is past IDLE).
   * Throws if the app is still in IDLE state.
   */
  private assertInitialized(method: string): void {
    if (this.lifecycle.getState() === LifecycleState.IDLE) {
      throw new Error(
        `[Sinwan.${method}] ` +
          `Lifecycle is in "idle" state. Call "await Sinwan.create()" first to initialize the app.`,
      );
    }
  }

  /**
   * Transition from INIT to READY if needed.
   * Awaits all ready event listeners before resolving.
   * No-op if already READY or past READY.
   */
  private async transitionToReady(
    port: number | string,
    protocol: "grpc" | "tcp" | "udp",
  ): Promise<void> {
    if (this.lifecycle.getState() === LifecycleState.INIT) {
      await this.lifecycle.ready({ port, protocol });
    }
  }

  /**
   * Gracefully shut down the server.
   * @param closeConn If true, immediately close all active connections.
   */
  async stop(closeConn: boolean = false): Promise<void> {
    const hasActiveServer = this.server !== undefined;

    if (this.lifecycle.is(LifecycleState.READY)) {
      await this.lifecycle.shutdown();
    }

    if (hasActiveServer) {
      this.server!.stop(closeConn);
    }
    this.tcpRouter.stop(closeConn);
    this.udpRouter.stop(this.runtime);
    if (hasGRPCProvider()) {
      await getGRPCProvider().stop();
    }

    if (this.lifecycle.is(LifecycleState.SHUTDOWN)) {
      await this.lifecycle.destroy();
    }

    this.server = undefined;
  }
}
