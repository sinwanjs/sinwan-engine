import type { udp } from "bun";
import type { Context, UDPData } from "../context/context";
import type { Runtime } from "../runtime";

export type UDPHook = (ctx: Context) => Promise<void> | void;

export type UDPDataHook = (
  ctx: Context,
  data: Buffer,
  port: number,
  addr: string,
) => Promise<void> | void;

export type UDPErrorHook = (ctx: Context, error: Error) => Promise<void> | void;

export interface UDPRouteConfig {
  open?: UDPHook;
  data?: UDPDataHook;
  drain?: UDPHook;
  error?: UDPErrorHook;
  close?: UDPHook;
}

export interface UDPListenOptions<T = unknown> {
  hostname?: string;
  port?: number;
  data?: T;
}

export interface UDPConnectOptions<T = unknown> {
  hostname: string;
  port: number;
  data?: T;
}

type SinwanUDPData<T = unknown> = Omit<UDPData, "data"> & {
  data: T | null;
};

// We intercept Bun's UDPSocket to attach our data
// But Bun's UDPSocket doesn't have a `.data` property by default.
// We can use a WeakMap or extend the object runtime, but for simplicity,
// we will just define it as having data.
export type SinwanUDPSocket<T = unknown> = udp.BaseUDPSocket & {
  data: SinwanUDPData<T>;
  sendMany(packets: readonly (Buffer | string | number)[]): number;
  send(
    data: Buffer | string | ArrayBufferLike | ArrayBufferView,
    port?: number,
    address?: string,
  ): boolean;
};

export class UDPRouter {
  public readonly name = "sinwan:udp-router";
  private readonly routes = new Map<string, UDPRouteConfig>();
  private readonly sockets: SinwanUDPSocket<UDPData>[] = [];

  udp(name: string, config: UDPRouteConfig): void {
    this.routes.set(name, config);
  }

  hasRoutes(): boolean {
    return this.routes.size > 0;
  }

  async listen<T = unknown>(
    runtime: Runtime,
    name: string,
    options: UDPListenOptions<T>,
  ): Promise<SinwanUDPSocket<T>> {
    const config = this.routes.get(name);
    if (!config) {
      throw new Error(`UDP route "${name}" is not registered.`);
    }

    let socketRef: SinwanUDPSocket<T>;

    const socket = await Bun.udpSocket({
      hostname: options.hostname ?? "0.0.0.0",
      ...(options.port !== undefined ? { port: options.port } : {}),
      socket: {
        data: (s, buf, port, addr) => {
          this.runUDPHook(
            runtime,
            socketRef,
            "udp:data",
            { name, data: buf, port, addr },
            config.data,
            buf as Buffer,
            port,
            addr,
          );
        },
        drain: () => {
          this.runUDPHook(
            runtime,
            socketRef,
            "udp:drain",
            { name },
            config.drain,
          );
        },
        error: (s, error) => {
          this.runUDPHook(
            runtime,
            socketRef,
            "udp:error",
            { name, error },
            config.error,
            error,
          );
        },
      },
    });

    socketRef = socket as unknown as SinwanUDPSocket<T>;
    socketRef.data = { name, data: options.data ?? null };
    this.sockets.push(socketRef as SinwanUDPSocket<UDPData>);

    // Manually trigger open hook since Bun UDP doesn't have one
    this.runUDPHook(runtime, socketRef, "udp:open", { name }, config.open);

    return socketRef;
  }

  async connect<T = unknown>(
    runtime: Runtime,
    name: string,
    options: UDPConnectOptions<T>,
  ): Promise<SinwanUDPSocket<T>> {
    const config = this.routes.get(name);
    if (!config) {
      throw new Error(`UDP route "${name}" is not registered.`);
    }

    let socketRef: SinwanUDPSocket<T>;

    const socket = await Bun.udpSocket({
      connect: {
        hostname: options.hostname,
        port: options.port,
      },
      socket: {
        data: (s, buf, port, addr) => {
          this.runUDPHook(
            runtime,
            socketRef,
            "udp:data",
            { name, data: buf, port, addr },
            config.data,
            buf as Buffer,
            port,
            addr,
          );
        },
        drain: () => {
          this.runUDPHook(
            runtime,
            socketRef,
            "udp:drain",
            { name },
            config.drain,
          );
        },
        error: (s, error) => {
          this.runUDPHook(
            runtime,
            socketRef,
            "udp:error",
            { name, error },
            config.error,
            error,
          );
        },
      },
    });

    socketRef = socket as unknown as SinwanUDPSocket<T>;
    socketRef.data = { name, data: options.data ?? null };
    this.sockets.push(socketRef as SinwanUDPSocket<UDPData>);

    this.runUDPHook(runtime, socketRef, "udp:open", { name }, config.open);

    return socketRef;
  }

  stop(runtime: Runtime): void {
    for (let i = 0; i < this.sockets.length; i += 1) {
      const socket = this.sockets[i];
      if (socket && !socket.closed) {
        const config = this.routes.get(socket.data.name);
        this.runUDPHook(
          runtime,
          socket,
          "udp:close",
          { name: socket.data.name },
          config?.close,
        );
        socket.close();
      }
    }
    this.sockets.length = 0;
  }

  private async udpHookError(
    runtime: Runtime,
    err: unknown,
    ctx?: Context,
  ): Promise<void> {
    await runtime.errorNormalizer.report(err, ctx);
    const payload = runtime.errorNormalizer.normalize(err);
    console.error(`[sinwan:udp] ${payload.message}`, err);
  }

  private runUDPHook<T, A extends unknown[]>(
    runtime: Runtime,
    socket: SinwanUDPSocket<T>,
    event: string,
    payload: unknown,
    hook: ((ctx: Context, ...args: A) => Promise<void> | void) | undefined,
    ...args: A
  ): void {
    if (!hook && !runtime.bus.hasListeners(event)) return;

    const ctx = runtime.acquireContext();
    ctx.setUDP(socket as SinwanUDPSocket<UDPData>);

    const finalize = () => {
      ctx.dispose();
      runtime.releaseContext(ctx);
    };

    try {
      const emitResult = runtime.bus.hasListeners(event)
        ? runtime.bus.emitAsync(event, ctx, payload, { source: "udp-router" })
        : undefined;

      const runHook = async () => {
        if (emitResult) await emitResult;
        if (!ctx.isStopped() && hook) await hook(ctx, ...args);
      };

      const result = runHook();
      result
        .catch((err) => this.udpHookError(runtime, err, ctx))
        .finally(finalize);
    } catch (err) {
      finalize();
      void this.udpHookError(runtime, err, ctx);
    }
  }
}
