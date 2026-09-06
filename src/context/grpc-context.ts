/**
 * SinwanJS Core Runtime — gRPC Context
 *
 * Per-call state container for gRPC method handlers.
 * Extends BaseContext with the gRPC call data and a minimal
 * response surface used to reject calls from `grpc:call` listeners.
 */

import { BaseContext, type ContextOptions } from "./base-context";
import type { ResponseKind } from "../types";

export interface GRPCData {
  name: string;
  package?: string;
  service: string;
  method: string;
  path: string;
  kind: "unary" | "serverStream" | "clientStream" | "bidi";
  request?: unknown;
  call: unknown;
  metadata: unknown;
  data: unknown;
}

export class GrpcContext extends BaseContext {
  public readonly protocol = "grpc" as const;

  public grpc?: GRPCData;

  constructor(options: ContextOptions) {
    super(options);
  }

  /** Status code carried alongside a committed response body. */
  public statusCode: number = 200;

  /** Response body — set via json() by grpc:call listeners to reject a call. */
  public body: unknown = null;

  /**
   * Set the gRPC call data (must be called before execute)
   */
  setGRPC(grpc: GRPCData): void {
    this.grpc = grpc;
  }

  /**
   * Commit a response on this context. Used by `grpc:call` listeners to
   * reject a call — the gRPC server converts the committed body/statusCode
   * into a gRPC error. Halts further execution like its HTTP counterpart.
   */
  json(data: unknown, status?: number): void {
    this.guardDoubleResponse();
    this.body = data;
    this.statusCode = status ?? this.statusCode;

    this._status |= BaseContext.RESPONDED;
    this._status |= BaseContext.STOPPED;

    if (this._bus && this._bus.hasListeners("response:set")) {
      const finalContentType = "application/json";
      this._bus.emitSync(
        "response:set",
        this,
        {
          kind: "json" as ResponseKind,
          statusCode: this.statusCode,
          contentType: finalContentType,
        },
        { source: "context", forceDelivery: true },
      );
    }

    this.emitStop();
  }

  override reset(options: ContextOptions): void {
    super.reset(options);
    this.grpc = undefined;
    this.statusCode = 200;
    this.body = null;
  }
}
