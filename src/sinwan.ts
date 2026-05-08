import { StepEngine } from "./step-engine";
import { EventBus } from "./event-bus";
import { ErrorHandler, type ErrorHook } from "./error-handler";
import { Runtime } from "./runtime";
import { Router, type RouteHandler } from "./router";
import { LifecycleManager } from "./lifecycle-manager";
import { Context } from "./context";
import type { Server } from "bun";
import type { Request } from "./types";

export interface AppOptions {
  onError?: ErrorHook;
  idleTimeout?: number;
}

export class Sinwan {

  /** Step Engine: Executes steps in order.*/
  /** Each step is a function that takes the context and returns a Promise.*/
  public readonly engine: StepEngine;

  /** Event Bus: Handles events for the application.*/
  public readonly bus: EventBus;

  /** Router: Handles routing for the application.*/
  public readonly router: Router;

  /** Runtime: Handles the runtime for the application.*/
  public readonly runtime: Runtime;

  /** Error Handler: Handles errors for the application.*/
  public readonly errorHandler: ErrorHandler;

  /** Lifecycle Manager: Manages the application lifecycle.*/
  public readonly lifecycle: LifecycleManager;

  /** Context: Manages the context for the application.*/
  private readonly context: Context;

  /** Shared State: Manages the shared state for the application.*/
  private readonly sharedState = new Map<string, any>();

  /** Config: Manages the configuration for the application.*/
  private readonly config: AppOptions;

  /** Server: Manages the server for the application.*/
  private server?: Server<any>;

  /**
   * Create a new SinwanJS application.
   * @param options Configuration options for the application.
   * @param options.onError Optional error handler function.
   * @param options.idleTimeout Optional idle timeout in milliseconds.
   */
  constructor(options: AppOptions = {}) {
    this.config = options;
    this.engine = new StepEngine();
    this.bus = new EventBus();
    this.errorHandler = new ErrorHandler({ onError: options.onError });
    this.router = new Router();
    this.context = new Context({ bus: this.bus, global: this.sharedState });

    this.runtime = new Runtime({
      engine: this.engine,
      bus: this.bus,
      errorHandler: this.errorHandler,
      globalState: this.sharedState,
    });

    this.lifecycle = new LifecycleManager(this.bus, this.context);

    this.runtime.use(this.router);
  }

  /**
   * Initialize the application and internal systems.
   * This method should be called before starting the server.
   */
  async init(): Promise<void> {
    await this.lifecycle.init({ options: this.config });
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
   * Serve static files from a directory.
   * @param prefix The URL prefix (e.g. "/public")
   * @param root   The local directory path (e.g. "./public")
   */
  static(prefix: string, root: string) {
    this.router.static(prefix, root);
  }

  /**
   * Start the server and listen for incoming requests.
   * @param port The port number to listen on.
   * @param callback Optional callback function to execute after the server starts.
   * @returns The Bun server instance.
   */
  listen(port: number | string = 3000, callback?: () => void): Server<any> {
    this.server = Bun.serve({
      port,
      idleTimeout: this.config.idleTimeout,
      fetch: (req, server) => this.runtime.fetch(req as Request, server),
    });

    // Transition to READY phase
    this.lifecycle.ready({ port, server: this.server });

    if (callback) {
      callback();
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

    await this.lifecycle.destroy();

    this.server = undefined;
  }
}
