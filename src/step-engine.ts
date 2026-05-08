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
  run(ctx: Context, bus: EventBus): void | Promise<void> {
    const stepCount = this.steps.length;
    if (stepCount === 0) return;

    // Fast path: single step (most common — just the router)
    if (stepCount === 1) {
      const step = this.steps[0]!;
      if (ctx.isStopped()) return;

      const hasStart = bus.hasListeners("step:start");
      if (hasStart) {
        return (async () => {
          const startResult = await bus.emitAsync(
            "step:start",
            ctx,
            { name: step.name },
            { source: "step-engine" },
          );
          if (startResult === "STOP" || ctx.isStopped()) return;

          try {
            const r = step.run(ctx, bus);
            const result = r instanceof Promise ? await r : r;
            const outcome = await this.handleResult(step, ctx, bus, result);
            // Check outcome for early termination
            if (
              outcome === "stop" ||
              outcome === "error" ||
              outcome === "responded" ||
              outcome === "responded_early"
            )
              return;
          } catch (error) {
            await this.handleStepError(step, ctx, bus, error);
            throw error;
          }
        })();
      }

      try {
        const r = step.run(ctx, bus);
        if (r instanceof Promise) {
          return (async () => {
            try {
              const result = await r;
              const outcome = await this.handleResult(step, ctx, bus, result);
              // Check outcome for early termination
              if (
                outcome === "stop" ||
                outcome === "error" ||
                outcome === "responded" ||
                outcome === "responded_early"
              )
                return;
            } catch (error) {
              await this.handleStepError(step, ctx, bus, error);
              throw error;
            }
          })();
        }
        const outcome = this.handleResultSync(step, ctx, bus, r);
        // Sync path: if we need to stop, the outcome is already handled
        // handleResultSync throws on error, so we don't need to check for "error" here
        return;
      } catch (error) {
        this.handleStepErrorSync(step, ctx, bus, error);
        throw error;
      }
    }

    // General path: multiple steps
    return (async () => {
      for (let i = 0; i < stepCount; i++) {
        const step = this.steps[i]!;
        if (ctx.isStopped()) break;

        if (bus.hasListeners("step:start")) {
          const startResult = await bus.emitAsync(
            "step:start",
            ctx,
            { name: step.name },
            { source: "step-engine" },
          );
          if (startResult === "STOP" || ctx.isStopped()) break;
        }

        try {
          const r = step.run(ctx, bus);
          const result = r instanceof Promise ? await r : r;
          const outcome = await this.handleResult(step, ctx, bus, result);

          if (
            outcome === "stop" ||
            outcome === "error" ||
            outcome === "responded"
          )
            break;
        } catch (error) {
          await this.handleStepError(step, ctx, bus, error);
          throw error;
        }
      }
    })();
  }

  private async handleResult(
    step: Step,
    ctx: Context,
    bus: EventBus,
    result: StepResult | void,
  ): Promise<string> {
    let outcome:
      | "continue"
      | "stop"
      | "responded"
      | "stopped"
      | "skipped"
      | "responded_early" = "continue";

    if (result) {
      if (result.type === "stop") {
        ctx.stop();
        outcome = "stopped";
      } else if (result.type === "error") {
        await this.handleStepError(step, ctx, bus, result.error);
        throw result.error;
      } else if (result.type === "skip") {
        outcome = "skipped";
      } else if (result.type === "respond") {
        outcome = "responded_early";
      }
    }

    if (outcome === "continue") {
      if (ctx.hasResponded()) outcome = "responded";
      else if (ctx.isStopped()) outcome = "stopped";
    }

    if (bus.hasListeners("step:end")) {
      await bus.emitAsync(
        "step:end",
        ctx,
        { name: step.name, outcome },
        { source: "step-engine" },
      );
    }

    return outcome;
  }

  private handleResultSync(
    step: Step,
    ctx: Context,
    bus: EventBus,
    result: StepResult | void,
  ):
    | "continue"
    | "stop"
    | "responded"
    | "stopped"
    | "skipped"
    | "responded_early" {
    let outcome:
      | "continue"
      | "stop"
      | "responded"
      | "stopped"
      | "skipped"
      | "responded_early" = "continue";

    if (result) {
      if (result.type === "stop") {
        ctx.stop();
        outcome = "stopped";
      } else if (result.type === "error") {
        this.handleStepErrorSync(step, ctx, bus, result.error);
        throw result.error;
      } else if (result.type === "skip") {
        outcome = "skipped";
      } else if (result.type === "respond") {
        outcome = "responded_early";
      }
      // "continue" type or void result: outcome stays "continue"
    }

    if (outcome === "continue") {
      if (ctx.hasResponded()) outcome = "responded";
      else if (ctx.isStopped()) outcome = "stopped";
    }

    if (bus.hasListeners("step:end")) {
      bus.emitSync(
        "step:end",
        ctx,
        { name: step.name, outcome },
        { source: "step-engine" },
      );
    }

    return outcome;
  }

  private async handleStepError(
    step: Step,
    ctx: Context,
    bus: EventBus,
    error: unknown,
  ) {
    if (bus.hasListeners("step:error")) {
      await bus.emitAsync(
        "step:error",
        ctx,
        { name: step.name, error },
        { source: "step-engine" },
      );
    }
  }

  private handleStepErrorSync(
    step: Step,
    ctx: Context,
    bus: EventBus,
    error: unknown,
  ) {
    if (bus.hasListeners("step:error")) {
      bus.emitSync(
        "step:error",
        ctx,
        { name: step.name, error },
        { source: "step-engine" },
      );
    }
  }
}
