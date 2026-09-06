/**
 * SinwanJS Core Runtime — WebSocket Context
 *
 * Per-connection state container for WebSocket lifecycle hooks.
 * Extends BaseContext with the WebSocket-specific surface.
 */

import type { Server, ServerWebSocket } from "bun";
import { BaseContext, type ContextOptions } from "./base-context";

export interface WSSData {
  path: string;
  data: unknown;
  /** Snapshot of the Context state from the upgrade request. */
  state?: Record<string, unknown>;
}

export class WsContext extends BaseContext {
  public readonly protocol = "ws" as const;

  public ws?: ServerWebSocket<WSSData>;

  constructor(options: ContextOptions) {
    super(options);
  }

  /**
   * Set the WebSocket (must be called before execute)
   */
  setWS(ws: ServerWebSocket<WSSData>): void {
    this.ws = ws;
  }

  override reset(options: ContextOptions): void {
    super.reset(options);
    this.ws = undefined;
  }

  // WebSocket Methods

  /**
   * Get the number of pending WebSocket connections.
   */
  get pendingWebSockets(): number {
    return this.getServer().pendingWebSockets;
  }

  /**
   * Publish a message to a topic.
   */
  publishToTopic(
    topic: string,
    data: Parameters<Server<unknown>["publish"]>[1],
    compress?: boolean,
  ): number {
    return this.getServer().publish(topic, data, compress);
  }

  /**
   * Get the data associated with this WebSocket.
   */
  wsData<T>(): T | undefined {
    return this.getWebSocket().data.data as T;
  }

  /**
   * Get the path of this WebSocket.
   */
  get path(): string {
    return this.getWebSocket().data.path;
  }

  /**
   * Get the remote address of this WebSocket.
   */
  get remoteAddress(): string {
    return this.getWebSocket().remoteAddress;
  }

  /**
   * Get the ready state of this WebSocket.
   */
  get readyState(): number {
    return this.getWebSocket().readyState;
  }

  /**
   * Get the subscriptions of this WebSocket.
   */
  get subscriptions(): string[] {
    return this.getWebSocket().subscriptions;
  }

  /**
   * Send a message to this WebSocket.
   */
  send(message: string | ArrayBuffer | Uint8Array, compress?: boolean): number {
    return this.getWebSocket().send(message, compress);
  }

  /**
   * Close this WebSocket.
   */
  close(code?: number, reason?: string): void {
    this.getWebSocket().close(code, reason);
  }

  /**
   * Subscribe to a topic [webSocket].
   */
  subscribe(topic: string): void {
    this.getWebSocket().subscribe(topic);
  }

  /**
   * Unsubscribe from a topic [webSocket].
   */
  unsubscribe(topic: string): void {
    this.getWebSocket().unsubscribe(topic);
  }

  /**
   * Publish a message to a topic [webSocket].
   */
  publish(
    topic: string,
    message: string | ArrayBuffer | Uint8Array,
    compress?: boolean,
  ): number {
    return this.getWebSocket().publish(topic, message, compress);
  }

  /**
   * Check if this WebSocket is subscribed to a topic [webSocket].
   */
  isSubscribed(topic: string): boolean {
    return this.getWebSocket().isSubscribed(topic);
  }

  /**
   * Cork this WebSocket.
   */
  cork(cb: (ctx: WsContext) => void): void {
    this.getWebSocket().cork(() => cb(this));
  }

  // ─── Guards ─────────────────────────────────────────────

  private getWebSocket(): ServerWebSocket<WSSData> {
    if (!this.ws) {
      throw new Error("Context is not attached to a WebSocket.");
    }
    return this.ws;
  }

  private getServer(): Server<unknown> {
    if (!this.server) {
      throw new Error("Context is not attached to a Server.");
    }
    return this.server;
  }
}
