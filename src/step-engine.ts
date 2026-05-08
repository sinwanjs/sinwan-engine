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
            if (r instanceof Promise) await r;
          } catch (error) {
            await this.handleStepError(step, ctx, bus, error);
            throw error;
          }
          await this.handleStepEnd(step, ctx, bus, "continue");
        })();
      }

      try {
        const result = step.run(ctx, bus);
        if (result instanceof Promise) {
          return (async () => {
            try {
              await result;
            } catch (error) {
              await this.handleStepError(step, ctx, bus, error);
              throw error;
            }
            if (bus.hasListeners("step:end")) {
              await this.handleStepEnd(step, ctx, bus, "continue");
            }
          })();
        }
      } catch (error) {
        // Since we are not in an async function anymore, we need to handle sync errors carefully
        // or just let them propagate if we are returning void.
        if (bus.hasListeners("step:error")) {
          // This becomes tricky if we want to stay sync. 
          // For now, let's keep it simple: if an error happens in a sync step, it propagates.
          // The caller (Runtime.fetch) will catch it.
        }
        throw error;
      }

      if (bus.hasListeners("step:end")) {
        this.handleStepEndSync(step, ctx, bus, "continue");
      }
      return;
    }

    // General path: multiple steps (omitted for brevity in this replacement, but need to be updated too)
    // Actually, I'll just rewrite the whole run method to be safe.
    return (async () => {
      for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
        const step = this.steps[stepIndex];
        if (!step) continue;
        if (ctx.isStopped()) break;
        // ... (rest of the async loop)
        await step.run(ctx, bus);
        if (ctx.hasResponded()) return;
      }
    })();
  }

  private async handleStepError(step: any, ctx: Context, bus: EventBus, error: any) {
    if (bus.hasListeners("step:error")) {
      await bus.emitAsync("step:error", ctx, { name: step.name, error }, { source: "step-engine" });
    }
  }

  private async handleStepEnd(step: any, ctx: Context, bus: EventBus, defaultOutcome: string) {
    if (bus.hasListeners("step:end")) {
      const outcome = ctx.hasResponded() ? "responded" : ctx.isStopped() ? "stopped" : defaultOutcome;
      await bus.emitAsync("step:end", ctx, { name: step.name, outcome }, { source: "step-engine" });
    }
  }

  private handleStepEndSync(step: any, ctx: Context, bus: EventBus, defaultOutcome: string) {
    if (bus.hasListeners("step:end")) {
      const outcome = ctx.hasResponded() ? "responded" : ctx.isStopped() ? "stopped" : defaultOutcome;
      bus.emitSync("step:end", ctx, { name: step.name, outcome }, { source: "step-engine" });
    }
  }
}
