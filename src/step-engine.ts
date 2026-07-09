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

import type { Context } from "./context/context";
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
   * Register a step at the front of the pipeline.
   * Useful for middleware that must run before routing.
   */
  prepend(step: Step): void {
    if (this.names.has(step.name)) {
      throw new Error(
        `StepEngine: Duplicate step name "${step.name}". Each step must have a unique name.`,
      );
    }
    this.names.add(step.name);
    this.steps.unshift(step);
  }

  /**
   * Execute all registered steps sequentially.
   * Respects stop signals and propagates errors.
   */
  run(ctx: Context, bus: EventBus): void | Promise<void> {
    const stepCount = this.steps.length;
    if (stepCount === 0 || ctx.isStopped()) return;

    // Fast path: single step with no step:start listeners (most common)
    if (stepCount === 1 && !bus.hasListeners("step:start")) {
      const step = this.steps[0]!;
      try {
        const r = step.run(ctx, bus);
        if (!(r instanceof Promise)) {
          this.handleResultSync(step, ctx, bus, r);
          return;
        }
        // Single async step — handle inline to avoid double execution
        return (async () => {
          try {
            const result = await r;
            await this.handleResult(step, ctx, bus, result);
          } catch (error) {
            await this.handleStepError(step, ctx, bus, error);
            throw error;
          }
        })();
      } catch (error) {
        this.handleStepErrorSync(step, ctx, bus, error);
        throw error;
      }
    }

    // General path (multiple steps or step:start listeners)
    return this.runSteps(ctx, bus, 0, stepCount);
  }

  private runSteps(
    ctx: Context,
    bus: EventBus,
    from: number,
    to: number,
  ): Promise<void> {
    return (async () => {
      for (let i = from; i < to; i++) {
        const step = this.steps[i]!;
        if (ctx.isStopped()) break;

        try {
          const outcome = await this.runStepAsync(step, ctx, bus);
          if (
            outcome === "stopped" ||
            outcome === "error" ||
            outcome === "responded" ||
            outcome === "responded_early"
          )
            break;
          if (outcome === "skipped") i++; // Skip the next step
        } catch (error) {
          await this.handleStepError(step, ctx, bus, error);
          throw error;
        }
      }
    })();
  }

  private async runStepAsync(
    step: Step,
    ctx: Context,
    bus: EventBus,
  ): Promise<string> {
    if (bus.hasListeners("step:start")) {
      const startResult = await bus.emitAsync(
        "step:start",
        ctx,
        { name: step.name },
        { source: "step-engine" },
      );
      if (startResult === "STOP" || ctx.isStopped()) return "stopped";
    }

    const r = step.run(ctx, bus);
    const result = r instanceof Promise ? await r : r;
    return this.handleResult(step, ctx, bus, result);
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
        throw result.error;
      } else if (result.type === "skip") {
        outcome = "skipped";
      } else if (result.type === "respond") {
        outcome = "responded_early";
      }
    }

    if (outcome === "continue") {
      if (ctx.isFailed()) {
        throw ctx.failError;
      }
      if (ctx.hasResponded()) outcome = "responded";
      else if (ctx.isStopped()) outcome = "stopped";
      else if (ctx.isRespondEarly()) outcome = "responded_early";
      else if (ctx.isSkipped()) outcome = "skipped";
    }

    if (bus.hasListeners("step:end")) {
      await bus.emitAsync(
        "step:end",
        ctx,
        { name: step.name, outcome },
        { source: "step-engine", forceDelivery: true },
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
        throw result.error;
      } else if (result.type === "skip") {
        outcome = "skipped";
      } else if (result.type === "respond") {
        outcome = "responded_early";
      }
      // "continue" type or void result: outcome stays "continue"
    }

    if (outcome === "continue") {
      if (ctx.isFailed()) {
        throw ctx.failError;
      }
      if (ctx.hasResponded()) outcome = "responded";
      else if (ctx.isStopped()) outcome = "stopped";
      else if (ctx.isRespondEarly()) outcome = "responded_early";
      else if (ctx.isSkipped()) outcome = "skipped";
    }

    if (bus.hasListeners("step:end")) {
      bus.emitSync(
        "step:end",
        ctx,
        { name: step.name, outcome },
        { source: "step-engine", forceDelivery: true },
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
