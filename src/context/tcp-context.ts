/**
 * SinwanJS Core Runtime — TCP Context
 *
 * Per-connection state container for TCP socket lifecycle hooks.
 * Extends BaseContext with the TCP-specific surface.
 */

import type { Socket } from "bun";
import { BaseContext, type ContextOptions } from "./base-context";

export interface TCPData {
  name: string;
  data: unknown;
}

export class TcpContext extends BaseContext {
  public readonly protocol = "tcp" as const;

  public tcp?: Socket<TCPData>;

  constructor(options: ContextOptions) {
    super(options);
  }

  /**
   * Set the TCP socket (must be called before execute)
   */
  setTCP(tcp: Socket<TCPData>): void {
    this.tcp = tcp;
  }

  override reset(options: ContextOptions): void {
    super.reset(options);
    this.tcp = undefined;
  }

  // TCP Socket Methods

  /**
   * Get the data associated with this TCP socket.
   */
  tcpData<T>(): T | undefined {
    return this.getTCPSocket().data.data as T;
  }

  /**
   * Get the name of this TCP socket.
   */
  get tcpName(): string {
    return this.getTCPSocket().data.name;
  }

  /**
   * Get the remote address of this TCP socket.
   */
  get tcpRemoteAddress(): string {
    return this.getTCPSocket().remoteAddress;
  }

  /**
   * Get the local address of this TCP socket.
   */
  get tcpLocalAddress(): string {
    return this.getTCPSocket().localAddress;
  }

  /**
   * Write data to this TCP socket.
   */
  write(
    data: Parameters<Socket<TCPData>["write"]>[0],
    byteOffset?: number,
    byteLength?: number,
  ): number {
    return this.getTCPSocket().write(data, byteOffset, byteLength);
  }

  /**
   * End this TCP socket.
   */
  end(
    data?: Parameters<Socket<TCPData>["write"]>[0],
    byteOffset?: number,
    byteLength?: number,
  ): number {
    return this.getTCPSocket().end(data, byteOffset, byteLength);
  }

  /**
   * Flush this TCP socket.
   */
  flush(): void {
    this.getTCPSocket().flush();
  }

  /**
   * Set the timeout for this TCP socket.
   */
  timeout(seconds: number): void {
    this.getTCPSocket().timeout(seconds);
  }

  // ─── Guards ─────────────────────────────────────────────

  private getTCPSocket(): Socket<TCPData> {
    if (!this.tcp) {
      throw new Error("Context is not attached to a TCP socket.");
    }
    return this.tcp;
  }
}
