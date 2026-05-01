/**
 * SinwanJS Core Runtime — Public API
 *
 * Barrel export for all public classes, functions, and types.
 */

// ─── Classes ──────────────────────────────────────────────

export { Context } from "./context";
export { StepEngine } from "./step-engine";
export { EventBus } from "./event-bus";
export { ErrorHandler } from "./error-handler";
export type { ErrorHook } from "./error-handler";
export { Runtime } from "./runtime";

// ─── Functions ────────────────────────────────────────────

export { buildResponse } from "./response";

export { Router } from "./router";

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
  InternalEventPayloads,
  InternalEventMap,
  ErrorPayload,
  Plugin,
} from "./types";
