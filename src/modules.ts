/**
 * Sinwan Module System — Protocol-agnostic route factories
 *
 * Encapsulates routes (HTTP, WS, TCP, UDP, gRPC) into self-contained modules
 * that can be registered in a single fluent call.
 *
 * ```ts
 * import { createHttpModule, createWSModule } from "sinwan-engine";
 *
 * const apiModule = createHttpModule({
 *   prefix: "/api/v1",
 *   routes: (app) => {
 *     app.get("/users", listUsers).post("/users", createUser);
 *   },
 * });
 *
 * const chatModule = createWSModule({
 *   path: "/chat",
 *   config: { open(ws) { ws.subscribe("room:1"); } },
 * });
 *
 * app.register(apiModule, chatModule);
 * ```
 */

import type { Sinwan } from "./sinwan";
import { HTTPRouter, type RouteHandler } from "./routers/http-router";
import type { WSRouteConfig } from "./routers/ws-router";
import type { TCPRouteConfig } from "./routers/tcp-router";
import { getGRPCProvider } from "./context/grpc-provider";
import type { UDPRouteConfig } from "./routers/udp-router";
import type { Plugin, Step } from "./types";

// ─── Core Module Interface ─────────────────────────────────

export interface SinwanModule {
  readonly name: string;
  readonly register: (app: Sinwan) => void;
}

// ─── Step Factory ───────────────────────────────────────────

export interface StepConfig {
  name: string;
  run: Step["run"];
}

export function createStep(config: StepConfig): Step;
export function createStep(name: string, run: Step["run"]): Step;
export function createStep(
  configOrName: StepConfig | string,
  run?: Step["run"],
): Step {
  if (typeof configOrName === "string") {
    return {
      name: configOrName,
      run: run!,
    };
  }

  return {
    name: configOrName.name,
    run: configOrName.run,
  };
}

// ─── Plugin Factory ─────────────────────────────────────────

export interface PluginConfig {
  name: string;
  install: Plugin["install"];
}

export function createPlugin(config: PluginConfig): Plugin;
export function createPlugin(name: string, install: Plugin["install"]): Plugin;
export function createPlugin(
  configOrName: PluginConfig | string,
  install?: Plugin["install"],
): Plugin {
  if (typeof configOrName === "string") {
    return {
      name: configOrName,
      install: install!,
    };
  }

  return {
    name: configOrName.name,
    install: configOrName.install,
  };
}

// ─── HTTP Module ─────────────────────────────────────────────

export interface HTTPModuleConfig {
  /** Route group prefix, e.g. "/api/v1" */
  prefix?: string;
  /** Register routes on the scoped HTTPRouter. */
  routes: (router: HTTPRouterFluent) => void;
  /** Optional description for debugging. */
  description?: string;
}

export interface HTTPModule extends SinwanModule {
  readonly type: "http";
  readonly prefix?: string;
}

/**
 * Fluent wrapper around HTTPRouter for module chaining.
 * Methods return `this` instead of `void`.
 */
export interface HTTPRouterFluent {
  /** Get request handler */
  get(path: string, ...handlers: RouteHandler[]): this;
  /** Post request handler */
  post(path: string, ...handlers: RouteHandler[]): this;
  /** Put request handler */
  put(path: string, ...handlers: RouteHandler[]): this;
  /** Patch request handler */
  patch(path: string, ...handlers: RouteHandler[]): this;
  /** Delete request handler */
  delete(path: string, ...handlers: RouteHandler[]): this;
  /** Options request handler */
  options(path: string, ...handlers: RouteHandler[]): this;
  /** Head request handler */
  head(path: string, ...handlers: RouteHandler[]): this;
  /** All request handler */
  all(path: string, ...handlers: RouteHandler[]): this;
  /** Use middleware */
  use(...handlers: RouteHandler[]): this;
  /** Create a sub-group with its own prefix. Receives a fluent router. */
  group(prefix: string, callback: (router: HTTPRouterFluent) => void): this;
  /** Mount another HTTPRouter under a prefix. */
  mount(prefix: string, httpRouter: HTTPRouter): this;
  /** Serve static files from a directory. */
  static(prefix: string, root: string): this;
}

function createFluentRouter(router: HTTPRouter): HTTPRouterFluent {
  const fluent = Object.create(router) as HTTPRouterFluent;
  const methods = [
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "options",
    "head",
    "all",
    "use",
  ] as const;
  for (const method of methods) {
    if (method === "use") {
      fluent[method] = (...handlers: RouteHandler[]) => {
        router.use(...handlers);
        return fluent;
      };
    } else {
      fluent[method] = (path: string, ...handlers: RouteHandler[]) => {
        router[method](path, ...handlers);
        return fluent;
      };
    }
  }

  // Wrap group to pass fluent router to callback
  fluent.group = (prefix: string, callback: (r: HTTPRouterFluent) => void) => {
    router.group(prefix, (childRouter) => {
      callback(createFluentRouter(childRouter));
    });
    return fluent;
  };

  fluent.mount = (prefix: string, httpRouter: HTTPRouter) => {
    router.mount(prefix, httpRouter);
    return fluent;
  };

  fluent.static = (prefix: string, root: string) => {
    router.static(prefix, root);
    return fluent;
  };

  return fluent;
}

export function createHttpModule(config: HTTPModuleConfig): HTTPModule {
  return {
    type: "http",
    name: config.description ?? `http:${config.prefix ?? "/"}`,
    prefix: config.prefix,
    register(app) {
      if (config.prefix) {
        app.group(config.prefix, (router) => {
          config.routes(createFluentRouter(router));
        });
      } else {
        // For root-level HTTP modules, create a temp router and mount it
        const router = new HTTPRouter();
        config.routes(createFluentRouter(router));
        app.mount("/", router);
      }
    },
  };
}

// ─── WebSocket Module ────────────────────────────────────────

export interface WSModuleConfig {
  path: string;
  config: WSRouteConfig;
  description?: string;
}

export interface WSModule extends SinwanModule {
  readonly type: "ws";
  readonly path: string;
}

export function createWSModule(config: WSModuleConfig): WSModule {
  return {
    type: "ws",
    name: config.description ?? `ws:${config.path}`,
    path: config.path,
    register(app) {
      app.ws(config.path, config.config);
    },
  };
}

// ─── TCP Module ──────────────────────────────────────────────

export interface TCPModuleConfig {
  name: string;
  config: TCPRouteConfig;
  description?: string;
}

export interface TCPModule extends SinwanModule {
  readonly type: "tcp";
}

export function createTCPModule(config: TCPModuleConfig): TCPModule {
  return {
    type: "tcp",
    name: config.description ?? `tcp:${config.name}`,
    register(app) {
      app.tcp(config.name, config.config);
    },
  };
}

// ─── UDP Module ──────────────────────────────────────────────

export interface UDPModuleConfig {
  name: string;
  config: UDPRouteConfig;
  description?: string;
}

export interface UDPModule extends SinwanModule {
  readonly type: "udp";
}

export function createUDPModule(config: UDPModuleConfig): UDPModule {
  return {
    type: "udp",
    name: config.description ?? `udp:${config.name}`,
    register(app) {
      app.udp(config.name, config.config);
    },
  };
}

export interface GRPCModuleConfig {
  name: string;
  config: unknown;
  description?: string;
}

export interface GRPCModule extends SinwanModule {
  readonly type: "grpc";
}

export function createGRPCModule(config: GRPCModuleConfig): GRPCModule {
  return {
    type: "grpc",
    name: config.description ?? `grpc:${config.name}`,
    register(_app) {
      getGRPCProvider().registerService(config.name, config.config);
    },
  };
}
