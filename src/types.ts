/**
 * SinwanJS Core Runtime — Shared Type Definitions
 *
 * All public types consumed across the engine modules.
 * Concrete class references (Context, EventBus) are imported
 * directly since they are always co-present at runtime.
 */

import type { BunRequest } from "bun";
import type { Context } from "./context";
import type { EventBus } from "./event-bus";

// ─── Lifecycle System ─────────────────────────────────────────

export enum LifecycleState {
  IDLE = "idle",
  INIT = "init",
  READY = "ready",
  SHUTDOWN = "shutdown",
  DESTROYED = "destroyed",
}

export type LifecycleEvent =
  | "app:init"
  | "app:ready"
  | "app:shutdown"
  | "app:destroy";

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
  run(ctx: Context, bus: EventBus): Promise<StepResult | void> | StepResult | void;
};

// ─── Event System ───────────────────────────────────────────

/** A single event handler function. */
export type EventSource =
  | "runtime"
  | "step-engine"
  | "context"
  | "app"
  | string;

export interface EventMeta {
  /** The listener channel that is being dispatched (can be a wildcard). */
  name: string;
  /** The original emitted event name. */
  event: string;
  /** Millisecond timestamp when the event was dispatched. */
  timestamp: number;
  /** Monotonic sequence number for this EventBus instance. */
  sequence: number;
  /** Request identifier if available on the Context. */
  requestId?: string;
  /** Who emitted the event (runtime, step-engine, context, etc.). */
  source?: EventSource;
}

export interface EmitOptions {
  source?: EventSource;
  requestId?: string;
  timestamp?: number;
}

export interface ListenerOptions {
  signal?: AbortSignal;
}

export type EventHandler<E extends string = string, P = any> = (
  ctx: Context,
  payload?: P,
  meta?: EventMeta,
) => Promise<unknown> | unknown;

/** Map of event names to their handler signatures. */
export type EventMap = Record<string,
  EventHandler<string>>;

export type EmitResult = "CONTINUE" | "STOP";

export interface EventTraceEntry {
  name: string;
  event: string;
  timestamp: number;
  sequence: number;
  requestId?: string;
  source?: EventSource;
  payload?: unknown;
}

export interface EventTraceOptions {
  enabled?: boolean;
  maxEntries?: number;
  includePayload?: boolean;
}

export interface SSEOptions {
  status?: number;
  retry?: number;
  timeout?: number;
}

export interface SSEController {
  send(
    data: string | object,
    event?: string,
    id?: string,
    retry?: number,
  ): void;
  comment(text: string): void;
  close(): void;
}

export interface EventBusOptions {
  captureRejections?: boolean;
  maxListeners?: number;
  enableWildcards?: boolean;
  wildcardDelimiter?: string;
}

export interface ContextOptions {
  requestId?: string;
  bus?: EventBus;
  trace?: EventTraceOptions;
  server?: any;
  global?: Map<string, any>;
}

export interface SaveFileOptions {
  /** Maximum file size in bytes. */
  maxSize?: number;
  /** List of allowed MIME types (e.g. ['image/png', 'application/pdf']). */
  allowedTypes?: string[];
}

export type ResponseKind = "json" | "text" | "stream" | "sse" | "file" | "buffer" | "iterator" | "unknown";

export interface InternalEventPayloads {
  "request:start": { method: string; url: string };
  "request:end": { durationMs: number };
  "request:error": { error: unknown };
  "step:start": { name: string };
  "step:end": {
    name: string;
    outcome: "continue" | "stop" | "responded" | "stopped";
  };
  "step:error": { name: string; error: unknown };
  "response:set": {
    kind: "json" | "text" | "stream" | "buffer" | "sse" | "file" | "iterator";
    statusCode: number;
    contentType: string;
  };
  "header:set": { key: string; value: string };
  "body:parsed": { kind: "json" | "form" | "text" };
  "body:parse:error": { error: unknown };
  "context:stop": undefined;
  "context:dispose": undefined;
  "app:init": { options: any };
  "app:ready": { port: number | string; server: any };
  "app:shutdown": undefined;
  "app:destroy": undefined;
}

export type InternalEventMap = {
  [K in keyof InternalEventPayloads]: EventHandler<K & string, InternalEventPayloads[K]>;
};

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

export interface Request<T extends string = string> extends BunRequest<T> { }
