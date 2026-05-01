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

// ─── Types ────────────────────────────────────────────────

export type {
  Step,
  StepResult,
  EventHandler,
  EventMap,
  ErrorPayload,
  Plugin,
} from "./types";