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
    const stepCount = this.steps.length;
    for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
      const step = this.steps[stepIndex];
      if (!step) continue;

      // Check context stop flag BEFORE running the step
      if (ctx.isStopped()) break;

      const startResult = await bus.emitAsync(
        "step:start",
        ctx,
        { name: step.name },
        { source: "step-engine" },
      );

      if (startResult === "STOP" || ctx.isStopped()) return;

      let result: StepResult | void;
      try {
        result = await step.run(ctx, bus);
      } catch (error) {
        await bus.emitAsync(
          "step:error",
          ctx,
          { name: step.name, error },
          { source: "step-engine" },
        );
        throw error;
      }

      const outcome = ctx.hasResponded()
        ? "responded"
        : ctx.isStopped()
          ? "stopped"
          : result?.type === "stop"
            ? "stop"
            : "continue";

      await bus.emitAsync(
        "step:end",
        ctx,
        { name: step.name, outcome },
        { source: "step-engine" },
      );

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
