/**
 * SinwanJS Core Runtime — Public API
 *
 * Barrel export for all public classes, functions, and types.
 */

// ─── Classes ──────────────────────────────────────────────

export { Context } from "./context";
export type { TCPData, WSSData } from "./context";
export { StepEngine } from "./step-engine";
export { EventBus } from "./event-bus";
export { ErrorHandler } from "./error-handler";
export type { ErrorHook } from "./error-handler";
export { Runtime } from "./runtime";
export { Sinwan, type AppOptions } from "./sinwan";
// ─── Functions ────────────────────────────────────────────

export { buildResponse } from "./response";

export { Router } from "./router";

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
  EventBusOptions,
  EventTraceEntry,
  EventTraceOptions,
  ContextOptions,
  SSEOptions,
  SSEController,
  InternalEventPayloads,
  InternalEventMap,
  ErrorPayload,
  Plugin,
} from "./types";
