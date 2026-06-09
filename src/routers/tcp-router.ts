import type { Socket, TCPSocketListener, UnixSocketListener } from "bun";
import type { Context, TCPData } from "../context/context";
import type { Runtime } from "../runtime";

export type TCPHook = (tcp: Context) => Promise<void> | void;

export type TCPDataHook = (tcp: Context, data: Buffer) => Promise<void> | void;

export type TCPCloseHook = (
  tcp: Context,
  error?: Error,
) => Promise<void> | void;

export type TCPErrorHook = (tcp: Context, error: Error) => Promise<void> | void;

export interface TCPRouteConfig {
  open?: TCPHook;
  data?: TCPDataHook;
  close?: TCPCloseHook;
  drain?: TCPHook;
  error?: TCPErrorHook;
}

export interface TCPClientConfig extends TCPRouteConfig {
  connectError?: TCPErrorHook;
  end?: TCPHook;
  timeout?: TCPHook;
}

export interface TCPListenOptions<T = unknown> {
  hostname?: string;
  port?: number | string;
  unix?: string;
  tls?: any;
  data?: T;
}

export interface TCPConnectOptions<T = unknown> extends TCPListenOptions<T> {}

type SinwanTCPData<T = unknown> = Omit<TCPData, "data"> & {
  data: T | null;
};

type SinwanTCPSocket<T = unknown> = Socket<SinwanTCPData<T>>;

type TCPServer<T = unknown> =
  | TCPSocketListener<SinwanTCPData<T>>
  | UnixSocketListener<SinwanTCPData<T>>;

export class TCPRouter {
  public readonly name = "sinwan:tcp-router";
  private readonly routes = new Map<string, TCPRouteConfig>();
  private readonly servers: TCPServer<any>[] = [];

  tcp(name: string, config: TCPRouteConfig): void {
    this.routes.set(name, config);
  }

  hasRoutes(): boolean {
    return this.routes.size > 0;
  }

  listen<T = unknown>(
    runtime: Runtime,
    name: string,
    options: TCPListenOptions<T>,
  ): TCPServer<T> {
    const config = this.routes.get(name);
    if (!config) {
      throw new Error(`TCP route "${name}" is not registered.`);
    }

    const socket = {
      open: (socket: SinwanTCPSocket<T>) => {
        socket.data = { name, data: options.data ?? null };
        this.runTCPHook(runtime, socket, "tcp:open", { name }, config.open);
      },
      data: (socket: SinwanTCPSocket<T>, data: Buffer) => {
        this.runTCPHook(
          runtime,
          socket,
          "tcp:data",
          { name, data },
          config.data,
          data,
        );
      },
      close: (socket: SinwanTCPSocket<T>, error?: Error) => {
        this.runTCPHook(
          runtime,
          socket,
          "tcp:close",
          { name, error },
          config.close,
          error,
        );
      },
      drain: (socket: SinwanTCPSocket<T>) => {
        this.runTCPHook(runtime, socket, "tcp:drain", { name }, config.drain);
      },
      error: (socket: SinwanTCPSocket<T>, error: Error) => {
        this.runTCPHook(
          runtime,
          socket,
          "tcp:error",
          { name, error },
          config.error,
          error,
        );
      },
    };

    const server =
      options.unix !== undefined
        ? Bun.listen<SinwanTCPData<T>>({
            unix: options.unix,
            ...(options.tls !== undefined ? { tls: options.tls } : {}),
            socket,
          })
        : Bun.listen<SinwanTCPData<T>>({
            hostname: options.hostname ?? "localhost",
            port: Number(options.port ?? 0),
            ...(options.tls !== undefined ? { tls: options.tls } : {}),
            socket,
          });

    this.servers.push(server);
    return server;
  }

  connect<T = unknown>(
    runtime: Runtime,
    name: string,
    options: TCPConnectOptions<T>,
    config: TCPClientConfig,
  ): Promise<SinwanTCPSocket<T>> {
    const socket = {
      open: (socket: SinwanTCPSocket<T>) => {
        socket.data = { name, data: options.data ?? null };
        this.runTCPHook(runtime, socket, "tcp:open", { name }, config.open);
      },
      data: (socket: SinwanTCPSocket<T>, data: Buffer) => {
        this.runTCPHook(
          runtime,
          socket,
          "tcp:data",
          { name, data },
          config.data,
          data,
        );
      },
      close: (socket: SinwanTCPSocket<T>, error?: Error) => {
        this.runTCPHook(
          runtime,
          socket,
          "tcp:close",
          { name, error },
          config.close,
          error,
        );
      },
      drain: (socket: SinwanTCPSocket<T>) => {
        this.runTCPHook(runtime, socket, "tcp:drain", { name }, config.drain);
      },
      error: (socket: SinwanTCPSocket<T>, error: Error) => {
        this.runTCPHook(
          runtime,
          socket,
          "tcp:error",
          { name, error },
          config.error,
          error,
        );
      },
      connectError: (socket: SinwanTCPSocket<T>, error: Error) => {
        socket.data = socket.data ?? { name, data: options.data ?? null };
        this.runTCPHook(
          runtime,
          socket,
          "tcp:connectError",
          { name, error },
          config.connectError,
          error,
        );
      },
      end: (socket: SinwanTCPSocket<T>) => {
        this.runTCPHook(runtime, socket, "tcp:end", { name }, config.end);
      },
      timeout: (socket: SinwanTCPSocket<T>) => {
        this.runTCPHook(
          runtime,
          socket,
          "tcp:timeout",
          { name },
          config.timeout,
        );
      },
    };

    return options.unix !== undefined
      ? Bun.connect<SinwanTCPData<T>>({
          unix: options.unix,
          ...(options.tls !== undefined ? { tls: options.tls } : {}),
          data: { name, data: options.data ?? null },
          socket,
        })
      : Bun.connect<SinwanTCPData<T>>({
          hostname: options.hostname ?? "localhost",
          port: Number(options.port),
          ...(options.tls !== undefined ? { tls: options.tls } : {}),
          data: { name, data: options.data ?? null },
          socket,
        });
  }

  stop(closeActiveConnections: boolean = false): void {
    for (let i = 0; i < this.servers.length; i += 1) {
      this.servers[i]?.stop(closeActiveConnections);
    }
    this.servers.length = 0;
  }

  private tcpHookError(err: unknown): void {
    console.error("[sinwan:tcp] Unhandled hook error:", err);
  }

  private runTCPHook(
    runtime: Runtime,
    socket: SinwanTCPSocket<any>,
    event: string,
    payload: unknown,
    hook?: (ctx: Context, ...args: any[]) => Promise<void> | void,
    ...args: any[]
  ): void {
    if (!hook && !runtime.bus.hasListeners(event)) return;

    const ctx = runtime.acquireContext();
    ctx.setTCP(socket);

    // TCP open goes through the StepEngine pipeline (auth, middleware, etc.)
    if (event === "tcp:open") {
      const runResult = runtime.engine.run(ctx, runtime.bus);

      const finalizeAndRunHook = async () => {
        if (runResult instanceof Promise) await runResult;
        if (ctx.isStopped()) {
          ctx.dispose();
          runtime.releaseContext(ctx);
          return;
        }
        this.runTCPHookPostEngine(runtime, ctx, event, payload, hook, args);
      };

      finalizeAndRunHook().catch(this.tcpHookError);
      return;
    }

    this.runTCPHookPostEngine(runtime, ctx, event, payload, hook, args);
  }

  private runTCPHookPostEngine(
    runtime: Runtime,
    ctx: Context,
    event: string,
    payload: unknown,
    hook?: (ctx: Context, ...args: any[]) => Promise<void> | void,
    args: any[] = [],
  ): void {
    const finalize = () => {
      ctx.dispose();
      runtime.releaseContext(ctx);
    };

    try {
      const emitResult = runtime.bus.hasListeners(event)
        ? runtime.bus.emitAsync(event, ctx, payload, { source: "tcp-router" })
        : undefined;

      const runHook = async () => {
        if (emitResult) await emitResult;
        if (!ctx.isStopped() && hook) await hook(ctx, ...args);
      };

      const result = runHook();
      result.catch(this.tcpHookError).finally(finalize);
    } catch (err) {
      ctx.dispose();
      runtime.releaseContext(ctx);
      this.tcpHookError(err);
    }
  }
}
