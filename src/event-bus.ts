/**
 * SinwanJS Core Runtime — EventBus
 *
 * Typed, sequential async event system. Handlers for a given
 * event execute in registration order (not parallel).
 *
 * Propagation stops if:
 *  - A handler returns the string "STOP"
 *  - ctx.isStopped() becomes true
 *
 * Errors thrown by handlers propagate up — they are never swallowed.
 */

import type { Context } from "./context";
import type { EventHandler } from "./types";

export class EventBus {
  private readonly listeners: Map<string, EventHandler[]> = new Map();

  /**
   * Register a handler for the given event.
   * Handlers are appended in registration order.
   */
  on(event: string, handler: EventHandler): void {
    const existing = this.listeners.get(event);
    if (existing) {
      existing.push(handler);
    } else {
      this.listeners.set(event, [handler]);
    }
  }

  /**
   * Emit an event, executing all registered handlers sequentially.
   *
   * @returns "STOP" if propagation was halted, "CONTINUE" otherwise.
   */
  async emit(
    event: string,
    ctx: Context,
    payload?: unknown,
  ): Promise<"CONTINUE" | "STOP"> {
    const handlers = this.listeners.get(event);
    if (!handlers) return "CONTINUE";

    for (const handler of handlers) {
      // Respect context stop flag between handlers
      if (ctx.isStopped()) return "STOP";

      const result = await handler(ctx, payload);

      // Handler explicitly requested stop
      if (result === "STOP") return "STOP";

      // Handler may have called ctx.stop() during execution
      if (ctx.isStopped()) return "STOP";
    }

    return "CONTINUE";
  }
}
