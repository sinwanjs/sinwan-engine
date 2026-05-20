/**
 * SinwanJS Core Runtime — Public API
 *
 * Barrel export for all public classes, functions, and types.
 */

// ─── Classes ──────────────────────────────────────────────

export { Context, type ContextOptions } from "./context";
export type { TCPData, WSSData, UDPData } from "./context";
export { StepEngine } from "./step-engine";
export { EventBus, type EventBusOptions } from "./event-bus";
export { ErrorHandler, type ErrorHandlerOptions } from "./error-handler";
export type { ErrorHook } from "./error-handler";
export { Runtime, type RuntimeConfig } from "./runtime";
export { Sinwan, type SinwanOptions } from "./sinwan";
// ─── Functions ────────────────────────────────────────────

export { buildResponse } from "./response";

export { Router, type RouteHandler } from "./router";

export { WSRouter } from "./ws-router";
export type {
  WSRouteConfig,
  WSOptions,
  Compressor,
  WSUpgradeHandler,
  WSHook,
  WSMessageHook,
  WSCloseHook,
  WSErrorHook,
  WSPingPongHook,
} from "./ws-router";

export { TCPRouter } from "./tcp-router";
export type {
  TCPClientConfig,
  TCPConnectOptions,
  TCPCloseHook,
  TCPDataHook,
  TCPErrorHook,
  TCPHook,
  TCPListenOptions,
  TCPRouteConfig,
} from "./tcp-router";

export { UDPRouter } from "./udp-router";
export type {
  UDPConnectOptions,
  UDPListenOptions,
  UDPRouteConfig,
  UDPHook,
  UDPDataHook,
  UDPErrorHook,
  SinwanUDPSocket,
} from "./udp-router";

export { captureRejectionSymbol, errorMonitor } from "node:events";

// ─── Types ────────────────────────────────────────────────

export type {
  Step,
  StepResult,
  EventHandler,
  EventMap,
  EventSource,
  EventMeta,
  EmitOptions,
  EmitResult,
  ListenerOptions,
  EventTraceEntry,
  EventTraceOptions,
  SSEOptions,
  SSEController,
  InternalEventPayloads,
  InternalEventMap,
  ErrorPayload,
  Plugin,
  LifecycleEvent,
  LifecycleState,
  ResponseKind,
  Request,
  SaveFileOptions,
} from "./types";
