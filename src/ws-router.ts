/**
 * SinwanJS Core Runtime — WSRouter Plugin
 *
 * Handles WebSocket route registration, HTTP-to-WS upgrade dispatch,
 * and Bun WebSocket lifecycle hook wiring.
 *
 * Design:
 *  - Static hook table: Map<path, WSRouteConfig> — O(1) lookup, zero emitter overhead.
 *  - Upgrade step runs in the normal HTTP StepEngine pipeline. If the upgrade hook
 *    calls ctx.json() / ctx.text(), the upgrade is rejected and a normal HTTP
 *    response is returned. Otherwise server.upgrade() is called and Bun handles 101.
 *  - WebSocket hooks use the same Context class as HTTP handlers.
 */

import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import type { Context, WSSData } from "./context";
import type { Plugin } from "./types";
import type { Runtime } from "./runtime";

// ─── Public Types ──────────────────────────────────────────

export type Compressor =
  | "disable"
  | "shared"
  | "dedicated"
  | "3KB"
  | "4KB"
  | "8KB"
  | "16KB"
  | "32KB"
  | "64KB"
  | "128KB"
  | "256KB";

/** Handler called before upgrading — runs inside the normal HTTP pipeline. */
export type WSUpgradeHandler = (ctx: Context) => Promise<void> | void;

/** Handler called on WS lifecycle events. */
export type WSHook<T = unknown> = (
  ws: Context<T>,
  ...args: any[]
) => Promise<void> | void;

export type WSMessageHook<T = unknown> = (
  ws: Context<T>,
  message: string | ArrayBuffer | Uint8Array,
) => Promise<void> | void;

export type WSCloseHook<T = unknown> = (
  ws: Context<T>,
  code: number,
  reason: string,
) => Promise<void> | void;

export type WSPingPongHook<T = unknown> = (
  ws: Context<T>,
  data: Buffer,
) => Promise<void> | void;

export type WSErrorHook<T = unknown> = (
  ws: Context<T>,
  error: Error,
) => Promise<void> | void;

/** Configuration object for a WebSocket route. */
export interface WSRouteConfig<T = unknown> {
  /** Called before the upgrade. Use ctx.set('ws:data', value) to attach typed data. */
  upgrade?: WSUpgradeHandler;
  /** Called when a socket connection is established. */
  open?: WSHook<T>;
  /** Called when a message is received. */
  message?: WSMessageHook<T>;
  /** Called when a socket is closed. */
  close?: WSCloseHook<T>;
  /** Called when a WebSocket error occurs. */
  error?: WSErrorHook<T>;
  /** Called when the socket is ready to receive more data after backpressure. */
  drain?: WSHook<T>;
  /** Called when a ping is received. */
  ping?: WSPingPongHook<T>;
  /** Called when a pong is received. */
  pong?: WSPingPongHook<T>;
}

/** Options forwarded to Bun's websocket configuration. */
export interface WSOptions {
  /** Enable per-message deflate compression. Default: false. */
  perMessageDeflate?:
    | boolean
    | {
        compress?: boolean | Compressor;
        decompress?: boolean | Compressor;
      };
  /** Idle timeout in seconds. Default: 120. */
  idleTimeout?: number;
  /** Maximum payload length in bytes. Default: 16MB. */
  maxPayloadLength?: number;
  /** Maximum buffered backpressure in bytes. Default: 1MB. */
  backpressureLimit?: number;
  /** Close connection when backpressure limit is reached. Default: false. */
  closeOnBackpressureLimit?: boolean;
  /** Send pings. Default: true. */
  sendPings?: boolean;
  /** Publish messages to self. Default: false. */
  publishToSelf?: boolean;
}

// ─── Internal ─────────────────────────────────────────────

/** Internal stored route entry. */
interface WSRouteEntry {
  path: string;
  config: WSRouteConfig<any>;
}

type BunWSMessage = string | ArrayBuffer | Uint8Array;

type SinwanWebSocketHandler = WebSocketHandler<WSSData> & {
  error?: (ws: ServerWebSocket<WSSData>, error: Error) => void;
};

// ─── WSRouter ─────────────────────────────────────────────

export class WSRouter implements Plugin {
  public readonly name = "sinwan:ws-router";

  /** Static hook table. Keyed by normalized path. */
  private readonly routes = new Map<string, WSRouteEntry>();

  /** WS server options forwarded to Bun.serve. */
  private wsOptions: WSOptions = {};

  /**
   * Register a WebSocket route.
   * @param path URL path to match for the upgrade request.
   * @param config Lifecycle hooks for this route.
   */
  ws<T = unknown>(path: string, config: WSRouteConfig<T>): void {
    const normalized = this.normalizePath(path);
    this.routes.set(normalized, { path: normalized, config });
  }

  /**
   * Set Bun WebSocket server-level options.
   * Called by Sinwan before building the Bun.serve config.
   */
  setOptions(opts: WSOptions): void {
    this.wsOptions = opts;
  }

  /**
   * Returns true if at least one WS route is registered.
   */
  hasRoutes(): boolean {
    return this.routes.size > 0;
  }

  /**
   * Build the websocket handler block for Bun.serve.
   * Returns undefined if no routes are registered.
   */
  buildWebSocketHandlers(runtime: Runtime): SinwanWebSocketHandler | undefined {
    if (this.routes.size === 0) return undefined;

    const routes = this.routes;

    return {
      ...this.wsOptions,

      open: (ws: ServerWebSocket<WSSData>) => {
        const entry = routes.get(ws.data.path);
        this.runWSHook(
          runtime,
          ws,
          "ws:open",
          { path: ws.data.path },
          entry?.config.open,
        );
      },

      message: (ws: ServerWebSocket<WSSData>, message: BunWSMessage) => {
        const entry = routes.get(ws.data.path);
        this.runWSHook(
          runtime,
          ws,
          "ws:message",
          { path: ws.data.path, message },
          entry?.config.message,
          message,
        );
      },

      close: (ws: ServerWebSocket<WSSData>, code: number, reason: string) => {
        const entry = routes.get(ws.data.path);
        this.runWSHook(
          runtime,
          ws,
          "ws:close",
          { path: ws.data.path, code, reason },
          entry?.config.close,
          code,
          reason,
        );
      },

      error: (ws: ServerWebSocket<WSSData>, error: Error) => {
        const entry = routes.get(ws.data.path);
        this.runWSHook(
          runtime,
          ws,
          "ws:error",
          { path: ws.data.path, error },
          entry?.config.error,
          error,
        );
      },

      drain: (ws: ServerWebSocket<WSSData>) => {
        const entry = routes.get(ws.data.path);
        this.runWSHook(
          runtime,
          ws,
          "ws:drain",
          { path: ws.data.path },
          entry?.config.drain,
        );
      },

      ping: (ws: ServerWebSocket<WSSData>, data: Buffer) => {
        const entry = routes.get(ws.data.path);
        this.runWSHook(
          runtime,
          ws,
          "ws:ping",
          { path: ws.data.path, data },
          entry?.config.ping,
          data,
        );
      },

      pong: (ws: ServerWebSocket<WSSData>, data: Buffer) => {
        const entry = routes.get(ws.data.path);
        this.runWSHook(
          runtime,
          ws,
          "ws:pong",
          { path: ws.data.path, data },
          entry?.config.pong,
          data,
        );
      },
    };
  }

  // ─── Plugin Installation ────────────────────────────────

  install(app: Runtime): void {
    const routes = this.routes;

    app.engine.add({
      name: "sinwan:ws-upgrade",
      run: (ctx: Context) => {
        const server = ctx.server;
        if (!server) return;

        const url = ctx.req.url;
        const pathname = this.extractPathname(url);
        const entry = routes.get(pathname);
        if (!entry) return;

        return (async () => {
          // Run optional upgrade hook — it may reject the connection
          if (entry.config.upgrade) {
            await entry.config.upgrade(ctx);
            // If the upgrade hook set a response, bail out (rejection path)
            if (ctx.hasResponded()) return;
          }

          // Retrieve any user data set in the upgrade hook
          const userData = ctx.get("ws:data");

          const success = (server as Server<WSSData>).upgrade(ctx.req, {
            data: { path: pathname, data: userData ?? null },
          });

          if (!success) {
            ctx.json({ error: "WebSocket upgrade failed" }, 500);
          }
          // On success Bun sends 101 automatically — no response needed
        })();
      },
    });
  }

  // ─── Helpers ──────────────────────────────────────────────

  private wsHookError(err: unknown): void {
    console.error("[sinwan:ws] Unhandled hook error:", err);
  }

  private runWSHook(
    runtime: Runtime,
    ws: ServerWebSocket<WSSData>,
    event: string,
    payload: unknown,
    hook?: (ctx: Context<any>, ...args: any[]) => Promise<void> | void,
    ...args: any[]
  ): void {
    if (!hook && !runtime.bus.hasListeners(event)) return;

    const ctx = runtime.acquireContext();
    ctx.setWS(ws);

    const finalize = () => {
      ctx.dispose();
      runtime.releaseContext(ctx);
    };

    try {
      const emitResult = runtime.bus.hasListeners(event)
        ? runtime.bus.emitAsync(event, ctx, payload, { source: "ws-router" })
        : undefined;

      const runHook = async () => {
        if (emitResult) await emitResult;
        if (!ctx.isStopped() && hook) await hook(ctx, ...args);
      };

      const result = runHook();
      result.catch(this.wsHookError).finally(finalize);
    } catch (err) {
      finalize();
      this.wsHookError(err);
    }
  }

  private normalizePath(p: string): string {
    if (p === "") return "/";
    if (p.length > 1 && p.charCodeAt(p.length - 1) === 47) {
      return p.slice(0, -1);
    }
    return p;
  }

  private extractPathname(url: string): string {
    const protoIdx = url.indexOf("://");
    let start = 0;
    if (protoIdx !== -1) {
      start = url.indexOf("/", protoIdx + 3);
      if (start === -1) return "/";
    }
    let end = url.length;
    for (let i = start; i < url.length; i++) {
      const cc = url.charCodeAt(i);
      if (cc === 63 || cc === 35) {
        end = i;
        break;
      }
    }
    if (end - start > 1 && url.charCodeAt(end - 1) === 47) end--;
    const pathname = url.slice(start, end);
    return pathname || "/";
  }
}
