/**
 * SinwanJS Core Runtime — StepEngine
 *
 * Deterministic sequential executor. Runs named Steps in
 * insertion order with no next() pattern and no implicit
 * flow control.
 *
 * Stop conditions (checked after each step):
 *  1. ctx.isStopped() === true
 *  2. StepResult.type === "stop"
 *  3. StepResult.type === "error" → throws
 *  4. void / "continue" → proceeds to next step
 */

import type { Context } from "./context";
import type { EventBus } from "./event-bus";
import type { Step, StepResult } from "./types";

export class StepEngine {
  private readonly steps: Step[] = [];
  private readonly names: Set<string> = new Set();

  /**
   * Register a step. Duplicate step names are rejected
   * with a thrown error to prevent silent ordering bugs.
   */
  add(step: Step): void {
    if (this.names.has(step.name)) {
      throw new Error(
        `StepEngine: Duplicate step name "${step.name}". Each step must have a unique name.`,
      );
    }
    this.names.add(step.name);
    this.steps.push(step);
  }

  /**
   * Execute all registered steps sequentially.
   * Respects stop signals and propagates errors.
   */
  async run(ctx: Context, bus: EventBus): Promise<void> {
    for (const step of this.steps) {
      // Check context stop flag BEFORE running the step
      if (ctx.isStopped()) break;

      const result: StepResult | void = await step.run(ctx, bus);

      // Auto-detect: if a response was sent, halt execution automatically
      if (ctx.hasResponded()) return;

      // void → implicit continue
      if (result === undefined || result === null) continue;

      switch (result.type) {
        case "continue":
          continue;

        case "stop":
          return;

        case "error":
          throw result.error;
      }
    }
  }
}
