import type { ServerWebSocket, Socket, SocketAddress } from "bun";
import type { Context, WSSData, TCPData, UDPData } from "./context";
import type { SinwanUDPSocket } from "../routers/udp-router";

/**
 * Focused helper for WebSocket, TCP, and UDP socket operations.
 * Extracted from Context to reduce the God Object surface.
 */
export class SocketHelper {
  constructor(private ctx: Context) {}

  // ─── WebSocket ────────────────────────────────────────────

  wsData<T>(): T | undefined {
    return this.getWebSocket().data.data as T;
  }

  get path(): string {
    return this.getWebSocket().data.path;
  }

  get remoteAddress(): string {
    return this.getWebSocket().remoteAddress;
  }

  get readyState(): number {
    return this.getWebSocket().readyState;
  }

  get subscriptions(): string[] {
    return this.getWebSocket().subscriptions;
  }

  send(message: string | ArrayBuffer | Uint8Array, compress?: boolean): number {
    return this.getWebSocket().send(message, compress);
  }

  close(code?: number, reason?: string): void {
    this.getWebSocket().close(code, reason);
  }

  subscribe(topic: string): void {
    this.getWebSocket().subscribe(topic);
  }

  unsubscribe(topic: string): void {
    this.getWebSocket().unsubscribe(topic);
  }

  publish(
    topic: string,
    message: string | ArrayBuffer | Uint8Array,
    compress?: boolean,
  ): number {
    return this.getWebSocket().publish(topic, message, compress);
  }

  isSubscribed(topic: string): boolean {
    return this.getWebSocket().isSubscribed(topic);
  }

  cork(cb: (ctx: Context) => void): void {
    this.getWebSocket().cork(() => cb(this.ctx));
  }

  // ─── TCP Socket ─────────────────────────────────────────

  tcpData<T>(): T | undefined {
    return this.getTCPSocket().data.data as T;
  }

  get tcpName(): string {
    return this.getTCPSocket().data.name;
  }

  get tcpRemoteAddress(): string {
    return this.getTCPSocket().remoteAddress;
  }

  get tcpLocalAddress(): string {
    return this.getTCPSocket().localAddress;
  }

  write(
    data: Parameters<Socket<TCPData>["write"]>[0],
    byteOffset?: number,
    byteLength?: number,
  ): number {
    return this.getTCPSocket().write(data, byteOffset, byteLength);
  }

  end(
    data?: Parameters<Socket<TCPData>["write"]>[0],
    byteOffset?: number,
    byteLength?: number,
  ): number {
    return this.getTCPSocket().end(data, byteOffset, byteLength);
  }

  flush(): void {
    this.getTCPSocket().flush();
  }

  timeout(seconds: number): void {
    this.getTCPSocket().timeout(seconds);
  }

  // ─── UDP Socket ─────────────────────────────────────────

  udpData<T>(): T | undefined {
    return this.getUDPSocket().data.data as T;
  }

  get udpName(): string {
    return this.getUDPSocket().data.name;
  }

  get udpAddress(): SocketAddress {
    return this.getUDPSocket().address;
  }

  get udpClosed(): boolean {
    return this.getUDPSocket().closed;
  }

  sendUDP(
    data: Parameters<SinwanUDPSocket<unknown>["send"]>[0],
    port?: number,
    address?: string,
  ): boolean {
    if (port !== undefined && address !== undefined) {
      return this.getUDPSocket().send(data, port, address);
    }
    return this.getUDPSocket().send(data);
  }

  sendManyUDP(
    packets: Parameters<SinwanUDPSocket<unknown>["sendMany"]>[0],
  ): number {
    return this.getUDPSocket().sendMany(packets);
  }

  addMembershipUDP(
    multicastAddress: string,
    interfaceAddress?: string,
  ): boolean {
    return this.getUDPSocket().addMembership(
      multicastAddress,
      interfaceAddress,
    );
  }

  dropMembershipUDP(
    multicastAddress: string,
    interfaceAddress?: string,
  ): boolean {
    return this.getUDPSocket().dropMembership(
      multicastAddress,
      interfaceAddress,
    );
  }

  // ─── Private socket accessors ───────────────────────────

  private getWebSocket(): ServerWebSocket<WSSData> {
    if (!this.ctx.ws) {
      throw new Error("Context is not attached to a WebSocket.");
    }
    return this.ctx.ws;
  }

  private getTCPSocket(): Socket<TCPData> {
    if (!this.ctx.tcp) {
      throw new Error("Context is not attached to a TCP socket.");
    }
    return this.ctx.tcp;
  }

  private getUDPSocket(): SinwanUDPSocket<UDPData> {
    if (!this.ctx.udp) {
      throw new Error("Context is not attached to a UDP socket.");
    }
    return this.ctx.udp;
  }
}
