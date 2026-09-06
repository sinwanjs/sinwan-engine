/**
 * SinwanJS Core Runtime — UDP Context
 *
 * Per-socket state container for UDP lifecycle hooks.
 * Extends BaseContext with the UDP-specific surface.
 */

import { BaseContext, type ContextOptions } from "./base-context";
import type { SinwanUDPSocket } from "../routers/udp-router";

export interface UDPData {
  name: string;
  data: unknown;
}

export class UdpContext extends BaseContext {
  public readonly protocol = "udp" as const;

  public udp?: SinwanUDPSocket<UDPData>;

  constructor(options: ContextOptions) {
    super(options);
  }

  /**
   * Set the UDP socket (must be called before execute)
   */
  setUDP(udp: SinwanUDPSocket<UDPData>): void {
    this.udp = udp;
  }

  override reset(options: ContextOptions): void {
    super.reset(options);
    this.udp = undefined;
  }

  // UDP Socket Methods

  /**
   * Get the data associated with this UDP socket.
   */
  udpData<T>(): T | undefined {
    return this.getUDPSocket().data.data as T;
  }

  /**
   * Get the name of this UDP socket.
   */
  get udpName(): string {
    return this.getUDPSocket().data.name;
  }

  /**
   * Get the address of this UDP socket.
   */
  get udpAddress(): import("bun").SocketAddress {
    return this.getUDPSocket().address;
  }

  /**
   * Check if this UDP socket is closed.
   */
  get udpClosed(): boolean {
    return this.getUDPSocket().closed;
  }

  /**
   * Send data to a UDP socket.
   */
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

  /**
   * Send multiple packets to a UDP socket.
   */
  sendManyUDP(
    packets: Parameters<SinwanUDPSocket<unknown>["sendMany"]>[0],
  ): number {
    return this.getUDPSocket().sendMany(packets);
  }

  /**
   * Add a multicast membership to this UDP socket.
   */
  addMembershipUDP(
    multicastAddress: string,
    interfaceAddress?: string,
  ): boolean {
    return this.getUDPSocket().addMembership(
      multicastAddress,
      interfaceAddress,
    );
  }

  /**
   * Drop a multicast membership from this UDP socket.
   */
  dropMembershipUDP(
    multicastAddress: string,
    interfaceAddress?: string,
  ): boolean {
    return this.getUDPSocket().dropMembership(
      multicastAddress,
      interfaceAddress,
    );
  }

  // ─── Private socket accessor ─────────────────────────────

  private getUDPSocket(): SinwanUDPSocket<UDPData> {
    if (!this.udp) {
      throw new Error("Context is not attached to a UDP socket.");
    }
    return this.udp;
  }
}
