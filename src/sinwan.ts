import { StepEngine } from "./step-engine";
import { EventBus } from "./event-bus";
import {
  ErrorHandler,
  type ErrorHandlerOptions,
  type ErrorHook,
} from "./error-handler";
import { Runtime } from "./runtime";
import { Router, type RouteHandler } from "./router";
import { WSRouter, type WSRouteConfig, type WSOptions } from "./ws-router";
import {
  TCPRouter,
  type TCPClientConfig,
  type TCPConnectOptions,
  type TCPListenOptions,
  type TCPRouteConfig,
} from "./tcp-router";
import {
  UDPRouter,
  type UDPConnectOptions,
  type UDPListenOptions,
  type UDPRouteConfig,
} from "./udp-router";
import { LifecycleManager } from "./lifecycle-manager";
import type { Context } from "./context";
import type {
  Server,
  Socket,
  TCPSocketListener,
  UnixSocketListener,
} from "bun";
import type { Request } from "./types";

/**
 * Minimal lifecycle context for app-level events.
 * Provides only what lifecycle events need, avoiding fake Context construction.
 * Uses type assertion since lifecycle events only need requestId and isStopped.
 */
function createLifecycleContext(): Context {
  return {
    requestId: "lifecycle",
    isStopped: () => false,
    recordEvent: () => {},
    hasResponded: () => false,
    isStreaming: () => false,
  } as unknown as Context;
}

export interface SinwanOptions {
  idleTimeout?: number;
  /** Maximum number of contexts to keep in the pool. Default: 1000 */
  maxPoolSize?: number;
  /** WebSocket server-level options (compression, limits, etc). */
  websocket?: WSOptions;
  /** Error handler options. */
  error?: ErrorHandlerOptions;
}

export class Sinwan {
  /** Step Engine: Executes steps in order.*/
  /** Each step is a function that takes the context and returns a Promise.*/
  public readonly engine: StepEngine;

  /** Event Bus: Handles events for the application.*/
  public readonly bus: EventBus;

  /** Router: Handles routing for the application.*/
  public readonly router: Router;

  /** WS Router: Handles WebSocket route registration and upgrade dispatch.*/
  public readonly wsRouter: WSRouter;

  /** TCP Router: Handles TCP route registration and Bun TCP server dispatch.*/
  public readonly tcpRouter: TCPRouter;

  /** UDP Router: Handles UDP route registration and socket dispatch.*/
  public readonly udpRouter: UDPRouter;

  /** Runtime: Handles the runtime for the application.*/
  public readonly runtime: Runtime;

  /** Error Handler: Handles errors for the application.*/
  public readonly errorHandler: ErrorHandler;

  /** Lifecycle Manager: Manages the application lifecycle.*/
  private readonly lifecycle: LifecycleManager;

  /** Lifecycle Context: Context for lifecycle events.*/
  private readonly lifecycleCtx: Context;

  /** Shared State: Manages the shared state for the application.*/
  private readonly sharedState = new Map<string, any>();

  /** Config: Manages the configuration for the application.*/
  private readonly config: SinwanOptions;

  /** Server: Manages the server for the application.*/
  private server?: Server<any>;

  /**
   * Create a new SinwanJS application.
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
    this.router = new Router();

    this.lifecycleCtx = createLifecycleContext();

    this.runtime = new Runtime({
      engine: this.engine,
      bus: this.bus,
      errorHandler: this.errorHandler,
      globalState: this.sharedState,
      maxPoolSize: options.maxPoolSize,
    });

    this.lifecycle = new LifecycleManager(this.bus, this.lifecycleCtx);

    this.runtime.use(this.router);

    this.wsRouter = new WSRouter();
    if (options.websocket) {
      this.wsRouter.setOptions(options.websocket);
    }
    this.tcpRouter = new TCPRouter();
    this.udpRouter = new UDPRouter();
  }

  /**
   * Register a GET route handler.
   * @param path The URL path pattern.
   * @param handlers The route handlers to register.
   */
  get(path: string, ...handlers: RouteHandler[]) {
    this.router.get(path, ...handlers);
  }
  /**
   * Register a POST route handler.
   * @param path The URL path pattern.
   * @param handlers The route handlers to register.
   */
  post(path: string, ...handlers: RouteHandler[]) {
    this.router.post(path, ...handlers);
  }
  /**
   * Register a PUT route handler.
   * @param path The URL path pattern.
   * @param handlers The route handlers to register.
   */
  put(path: string, ...handlers: RouteHandler[]) {
    this.router.put(path, ...handlers);
  }
  /**
   * Register a PATCH route handler.
   * @param path The URL path pattern.
   * @param handlers The route handlers to register.
   */
  patch(path: string, ...handlers: RouteHandler[]) {
    this.router.patch(path, ...handlers);
  }

  /**
   * Register a DELETE route handler.
   * @param path The URL path pattern.
   * @param handlers The route handlers to register.
   */
  delete(path: string, ...handlers: RouteHandler[]) {
    this.router.delete(path, ...handlers);
  }

  /**
   * Register an OPTIONS route handler.
   * @param path The URL path pattern.
   * @param handlers The route handlers to register.
   */
  options(path: string, ...handlers: RouteHandler[]) {
    this.router.options(path, ...handlers);
  }
  /**
   * Register a HEAD route handler.
   * @param path The URL path pattern.
   * @param handlers The route handlers to register.
   */
  head(path: string, ...handlers: RouteHandler[]) {
    this.router.head(path, ...handlers);
  }

  /**
   * Register an ALL route handler.
   * @param path The URL path pattern.
   * @param handlers The route handlers to register.
   */
  all(path: string, ...handlers: RouteHandler[]) {
    this.router.all(path, ...handlers);
  }

  /**
   * Register a WebSocket route.
   * @param path The URL path to match for the upgrade request.
   * @param config Lifecycle hooks: upgrade, open, message, close, drain, error.
   *
   * @example
   * app.ws<{ userId: string }>('/chat', {
   *   upgrade(ctx) {
   *     ctx.set('ws:data', { userId: ctx.req.headers.get('x-user-id') });
   *   },
   *   open(ws) { ws.subscribe('room:1'); },
   *   message(ws, msg) { ws.publish('room:1', msg); },
   *   close(ws) { ws.unsubscribe('room:1'); },
   * });
   */
  ws<T = unknown>(path: string, config: WSRouteConfig<T>): void {
    this.wsRouter.ws(path, config);
  }

  tcp<T = unknown>(name: string, config: TCPRouteConfig<T>): void {
    this.tcpRouter.tcp(name, config);
  }

  udp<T = unknown>(name: string, config: UDPRouteConfig<T>): void {
    this.udpRouter.udp(name, config);
  }

  /**
   * Register a route handler for all HTTP methods.
   * @param handlers The route handlers to register.
   */
  use(...handlers: RouteHandler[]) {
    this.router.use(...handlers);
  }

  /**
   * Create a route group with a common prefix.
   * @param prefix The prefix for the routes in the group.
   * @param callback The callback function to register the routes.
   */
  group(prefix: string, callback: (router: Router) => void) {
    this.router.group(prefix, callback);
  }

  /**
   * Mount an existing router instance under a prefix.
   * @param prefix The prefix to mount the router at.
   * @param router The router instance to mount.
   */
  mount(prefix: string, router: Router) {
    this.router.mount(prefix, router);
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
    server?: Server<any>,
  ): Response | Promise<Response> {
    if (input instanceof globalThis.Request) {
      if (init !== undefined) {
        input = new globalThis.Request(input, init);
      }
      return this.runtime.fetch(input as any, server || ({} as any));
    }

    // Support relative paths by providing a base URL
    const url =
      typeof input === "string" && input.startsWith("/")
        ? `http://localhost${input}`
        : input.toString();

    return this.runtime.fetch(
      new globalThis.Request(url, init) as any,
      server || ({} as any),
    );
  }

  /**
   * Serve static files from a directory.
   * @param prefix The URL prefix (e.g. "/public")
   * @param root   The local directory path (e.g. "./public")
   */
  static(prefix: string, root: string) {
    this.router.static(prefix, root);
  }

  listenTCP<T = unknown>(
    name: string,
    options: TCPListenOptions<T>,
  ): TCPSocketListener<any> | UnixSocketListener<any> {
    return this.tcpRouter.listen(this.runtime, name, options);
  }

  connectTCP<T = unknown>(
    name: string,
    options: TCPConnectOptions<T>,
    config: TCPClientConfig<T>,
  ): Promise<Socket<any>> {
    return this.tcpRouter.connect(this.runtime, name, options, config);
  }

  listenUDP<T = unknown>(
    name: string,
    options: UDPListenOptions<T>,
  ): Promise<import("./udp-router").SinwanUDPSocket<T>> {
    return this.udpRouter.listen(this.runtime, name, options);
  }

  connectUDP<T = unknown>(
    name: string,
    options: UDPConnectOptions<T>,
  ): Promise<import("./udp-router").SinwanUDPSocket<T>> {
    return this.udpRouter.connect(this.runtime, name, options);
  }

  /**
   * Start the server and listen for incoming requests.
   * @param port The port number to listen on.
   * @param callback Optional callback function to execute after the server starts.
   * @returns The Bun server instance.
   * @throws If the server fails to start or lifecycle transition fails.
   */
  async listen(
    port: number | string = 3000,
    callback?: () => void,
  ): Promise<Server<any>> {
    // Initialize lifecycle 
    if (this.lifecycle.getState() === ("idle" as any)) {
      try {
        await this.lifecycle.init({ options: this.config });
      } catch (error) {
        throw new Error(
          `Failed to initialize application: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    }

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
      await this.lifecycle.ready({ port, server: this.server });
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
        callback();
      } catch (error) {
        // Log but don't fail - callback errors shouldn't crash the server
        console.error("[Sinwan] Listen callback error:", error);
      }
    }

    return this.server;
  }

  /**
   * Gracefully shut down the server.
   * @param closeConn If true, immediately close all active connections.
   */
  async stop(closeConn: boolean = false): Promise<void> {
    if (!this.server) return;

    await this.lifecycle.shutdown();

    this.server.stop(closeConn);
    this.tcpRouter.stop(closeConn);
    this.udpRouter.stop();

    await this.lifecycle.destroy();

    this.server = undefined;
  }
}
