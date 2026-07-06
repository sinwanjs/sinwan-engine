/**
 * SinwanJS Core Runtime — Public API
 *
 * Barrel export for all public classes, functions, and types.
 */

// ─── Classes ──────────────────────────────────────────────

export { Context, type ContextOptions } from "./context/context";
export type { GRPCData, TCPData, WSSData, UDPData } from "./context/context";
export { StepEngine } from "./step-engine";
export { EventBus, type EventBusOptions } from "./event-bus";
export { ErrorHandler, type ErrorHandlerOptions } from "./error-handler";
export type {
  ErrorHook,
  ErrorResponseType,
  ErrorResponseFormatter,
} from "./error-handler";
export {
  ErrorNormalizer,
  type ErrorNormalizerOptions,
} from "./error-normalizer";
export { Runtime, type RuntimeConfig } from "./runtime";
export { Sinwan, type SinwanOptions } from "./sinwan";
export {
  LifecycleManager,
  type LifecyclePayloads,
  type LifecycleEventName,
} from "./lifecycle-manager";
// ─── Functions ────────────────────────────────────────────

export { buildResponse } from "./response";
export { SocketHelper } from "./context/socket-helper";
export {
  InternalAssets,
  type InternalAssetsOptions,
  type AssetHandler,
  type AssetEntry,
} from "./internal-assets";

export {
  createStep,
  createPlugin,
  createHttpModule,
  createWSModule,
  createTCPModule,
  createUDPModule,
  createGRPCModule,
} from "./modules";
export type {
  StepConfig,
  PluginConfig,
  SinwanModule,
  HTTPModule,
  HTTPModuleConfig,
  HTTPRouterFluent,
  WSModule,
  WSModuleConfig,
  TCPModule,
  TCPModuleConfig,
  UDPModule,
  UDPModuleConfig,
  GRPCModule,
  GRPCModuleConfig,
} from "./modules";

export { HTTPRouter, type RouteHandler } from "./routers/http-router";

export { WSRouter } from "./routers/ws-router";
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
} from "./routers/ws-router";

export { TCPRouter } from "./routers/tcp-router";
export type {
  TCPClientConfig,
  TCPConnectOptions,
  TCPCloseHook,
  TCPDataHook,
  TCPErrorHook,
  TCPHook,
  TCPListenOptions,
  TCPRouteConfig,
} from "./routers/tcp-router";

export { UDPRouter } from "./routers/udp-router";
export type {
  UDPConnectOptions,
  UDPListenOptions,
  UDPRouteConfig,
  UDPHook,
  UDPDataHook,
  UDPErrorHook,
  SinwanUDPSocket,
} from "./routers/udp-router";

export {
  type GRPCProvider,
  registerGRPCProvider,
  getGRPCProvider,
  hasGRPCProvider,
} from "./context/grpc-provider";

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
  GRPCCallPayload,
} from "./types";
