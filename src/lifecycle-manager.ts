import { EventEmitter } from "node:events";
import { LifecycleState } from "./types";
import type { SinwanOptions } from "./sinwan";

export interface LifecyclePayloads {
  /** Fires once during app bootstrap. Use for plugins, DB connections, config loading. */
  init: { options: SinwanOptions };
  /** Fires when the server starts listening. Use for health checks, metrics, loggers. */
  ready: { port: number | string; server: any };
  /** Fires on graceful shutdown (SIGTERM / SIGINT). Use to stop accepting new work. */
  shutdown: undefined;
  /** Final cleanup. Use to close DB connections, flush logs, free resources. */
  destroy: undefined;
}

export type LifecycleEventName = keyof LifecyclePayloads;

/**
 * Controls the deterministic flow of your application through five phases.
 *
 * **Phase diagram:**
 * ```
 *   IDLE ──init()──► INIT ──ready()──► READY
 *                    │                  │
 *                    │                  │ shutdown()
 *                    │                  ▼
 *                    │               SHUTDOWN ──destroy()──► DESTROYED
 *                    │                  │
 *                    └──────────────────┘ (restart path: not yet supported)
 * ```
 *
 * Each phase emits an event you can subscribe to with `.on()`, `.once()`, or `.off()`.
 * Transitions are **strictly guarded** — calling `ready()` before `init()` throws.
 */
export class LifecycleManager {
  private readonly emitter = new EventEmitter();
  private state: LifecycleState = LifecycleState.IDLE;

  on<K extends LifecycleEventName>(
    event: K,
    handler: (payload: LifecyclePayloads[K]) => void | Promise<void>,
  ): this {
    this.emitter.on(event, handler);
    return this;
  }

  off<K extends LifecycleEventName>(
    event: K,
    handler: (payload: LifecyclePayloads[K]) => void | Promise<void>,
  ): this {
    this.emitter.off(event, handler);
    return this;
  }

  once<K extends LifecycleEventName>(
    event: K,
    handler: (payload: LifecyclePayloads[K]) => void | Promise<void>,
  ): this {
    this.emitter.once(event, handler);
    return this;
  }

  /**
   * Transition to **INIT** phase.
   *
   * ```ts
   * app.lifecycle.on("init", ({ options }) => {
   *   await db.connect(options.dbUrl);
   * });
   * ```
   *
   * @throws If already past INIT.
   */
  async init(payload?: LifecyclePayloads["init"]): Promise<void> {
    this.transitionTo(LifecycleState.INIT, [LifecycleState.IDLE]);
    await this.emit("init", payload);
  }

  /**
   * Transition to **READY** phase.
   *
   * ```ts
   * app.lifecycle.on("ready", ({ port }) => {
   *   console.log(`Server live on ${port}`);
   * });
   * ```
   *
   * @throws If not in INIT.
   */
  async ready(payload?: LifecyclePayloads["ready"]): Promise<void> {
    this.transitionTo(LifecycleState.READY, [LifecycleState.INIT]);
    await this.emit("ready", payload);
  }

  /**
   * Transition to **SHUTDOWN** phase.
   * Stop accepting new requests, close keep-alive connections.
   *
   * ```ts
   * process.on("SIGTERM", () => app.lifecycle.shutdown());
   * ```
   *
   * @throws If not in INIT or READY.
   */
  async shutdown(payload?: LifecyclePayloads["shutdown"]): Promise<void> {
    this.transitionTo(LifecycleState.SHUTDOWN, [
      LifecycleState.READY,
      LifecycleState.INIT,
    ]);
    await this.emit("shutdown", payload);
  }

  /**
   * Transition to **DESTROYED** phase.
   * Final cleanup — close DB pools, flush logs, free handles.
   *
   * @throws If not in SHUTDOWN.
   */
  async destroy(payload?: LifecyclePayloads["destroy"]): Promise<void> {
    this.transitionTo(LifecycleState.DESTROYED, [LifecycleState.SHUTDOWN]);
    await this.emit("destroy", payload);
  }

  /** Current lifecycle state. */
  getState(): LifecycleState {
    return this.state;
  }

  /** Check if current state matches. */
  is(state: LifecycleState): boolean {
    return this.state === state;
  }

  /** Check if a transition to `target` is valid from the current state. */
  can(target: LifecycleState): boolean {
    const allowed: Record<LifecycleState, LifecycleState[]> = {
      [LifecycleState.IDLE]: [LifecycleState.INIT],
      [LifecycleState.INIT]: [LifecycleState.READY],
      [LifecycleState.READY]: [LifecycleState.SHUTDOWN],
      [LifecycleState.SHUTDOWN]: [LifecycleState.DESTROYED],
      [LifecycleState.DESTROYED]: [],
    };
    return allowed[this.state]?.includes(target) ?? false;
  }

  /**
   * Assert the current state is one of the allowed values.
   * @throws with a descriptive message if the assertion fails.
   */
  assert(...allowed: LifecycleState[]): void {
    if (!allowed.includes(this.state)) {
      throw new Error(
        `[Lifecycle] Expected state ${allowed.join(" | ")}, but current state is "${this.state}".`,
      );
    }
  }

  /**
   * Internal helper to enforce strict state transitions.
   */
  private transitionTo(
    next: LifecycleState,
    allowedCurrent: LifecycleState[],
  ): void {
    if (!allowedCurrent.includes(this.state)) {
      throw new Error(
        `[Lifecycle] Cannot transition to "${next}" from "${this.state}". ` +
          `Allowed: ${allowedCurrent.join(" | ")}`,
      );
    }
    this.state = next;
  }

  private async emit<K extends LifecycleEventName>(
    event: K,
    payload?: LifecyclePayloads[K],
  ): Promise<void> {
    const listeners = this.emitter.listeners(event);
    for (const listener of listeners) {
      await (listener as Function)(payload);
    }
  }
}
