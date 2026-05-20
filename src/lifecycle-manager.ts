import { LifecycleState } from "./types";
import type { EventBus } from "./event-bus";
import type { Context } from "./context";

/**
 * LifecycleManager ensures a strict, deterministic progression of application phases.
 *
 * Flow: IDLE -> INIT -> READY -> SHUTDOWN -> DESTROYED
 */
export class LifecycleManager {
  private state: LifecycleState = LifecycleState.IDLE;
  private lifecycleCtx: Context;

  constructor(
    private readonly bus: EventBus,
    context: Context,
  ) {
    this.lifecycleCtx = context;
  }

  /**
   * Transition to INIT phase.
   * Typically used for setting up internal systems and registering plugins.
   */
  async init<T>(payload?: T): Promise<void> {
    this.transitionTo(LifecycleState.INIT, [LifecycleState.IDLE]);
    await this.bus.emitAsync("app:init", this.lifecycleCtx, payload, {
      source: "app",
    });
  }

  /**
   * Transition to READY phase.
   * Typically triggered once the server is successfully listening.
   */
  async ready<T>(payload?: T): Promise<void> {
    this.transitionTo(LifecycleState.READY, [LifecycleState.INIT]);
    await this.bus.emitAsync("app:ready", this.lifecycleCtx, payload, {
      source: "app",
    });
  }

  /**
   * Transition to SHUTDOWN phase.
   * Stops accepting new work and prepares for cleanup.
   */
  async shutdown<T>(payload?: T): Promise<void> {
    this.transitionTo(LifecycleState.SHUTDOWN, [
      LifecycleState.READY,
      LifecycleState.INIT,
    ]);
    await this.bus.emitAsync("app:shutdown", this.lifecycleCtx, payload, {
      source: "app",
    });
  }

  /**
   * Transition to DESTROYED phase.
   * Final cleanup of all resources (database connections, file handles).
   */
  async destroy<T>(payload?: T): Promise<void> {
    this.transitionTo(LifecycleState.DESTROYED, [LifecycleState.SHUTDOWN]);
    await this.bus.emitAsync("app:destroy", this.lifecycleCtx, payload, {
      source: "app",
    });
  }

  /**
   * Return the current lifecycle state.
   */
  getState(): LifecycleState {
    return this.state;
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
        `[Lifecycle Error]: Cannot transition to "${next}" from "${this.state}". ` +
          `Allowed previous states: ${allowedCurrent.join(", ")}`,
      );
    }
    this.state = next;
  }
}
