/**
 * SinwanJS Core Runtime — Shared Type Definitions
 *
 * All public types consumed across the engine modules.
 * Concrete class references (Context, EventBus) are imported
 * directly since they are always co-present at runtime.
 */

import type { Context } from "./context";
import type { EventBus } from "./event-bus";

// ─── Step System ────────────────────────────────────────────

/** Discriminated union returned by a Step's run() method. */
export type StepResult =
  | { type: "continue" }
  | { type: "stop" }
  | { type: "error"; error: unknown };

/**
 * A named, deterministic execution unit.
 * Steps execute sequentially — no next(), no chaining.
 */
export type Step = {
  readonly name: string;
  run(ctx: Context, bus: EventBus): Promise<StepResult | void>;
};

// ─── Event System ───────────────────────────────────────────

/** A single event handler function. */
export type EventHandler = (
  ctx: Context,
  payload?: unknown,
) => Promise<unknown> | unknown;

/** Map of event names to their handler signatures. */
export interface EventMap {
  [eventName: string]: EventHandler;
}

// ─── Error System ───────────────────────────────────────────

/** Normalized error structure produced by ErrorHandler. */
export interface ErrorPayload {
  message: string;
  statusCode?: number;
}

// ─── Plugin System ──────────────────────────────────────────

import type { Runtime } from "./runtime";

/**
 * A plugin encapsulates a set of features (Steps, Event Listeners, Services).
 */
export interface Plugin {
  readonly name: string;
  install(app: Runtime): void;
}
