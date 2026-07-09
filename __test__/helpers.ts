import { Context, type ContextOptions } from "../src/context/context";
import { EventBus, type EventBusOptions } from "../src/event-bus";
import { ErrorHandler, type ErrorHandlerOptions } from "../src/error-handler";
import type { Step } from "../src/types";

/**
 * Create a real EventBus instance for testing.
 */
export function createTestBus(options?: EventBusOptions): EventBus {
  return new EventBus(options);
}

/**
 * Create a real Context instance for testing.
 * The Context is backed by a real ErrorHandler and optionally a real EventBus.
 */
export function createTestContext(
  bus?: EventBus,
  overrides?: Partial<ContextOptions>,
): Context {
  const errorHandler = new ErrorHandler();
  return new Context({
    bus,
    errorHandler,
    ...overrides,
  });
}

/**
 * Create a simple step that records its execution order.
 * The step appends its name to the provided array when run.
 */
export function createRecordingStep(
  name: string,
  log: string[],
  result: Step["run"] = () => {},
): Step {
  return {
    name,
    run(ctx, bus) {
      log.push(name);
      return result(ctx, bus);
    },
  };
}

/**
 * Create a step that returns a specific StepResult.
 */
export function createResultStep(
  name: string,
  result: import("../src/types").StepResult,
): Step {
  return {
    name,
    run() {
      return result;
    },
  };
}

/**
 * Create a step that throws an error.
 */
export function createThrowingStep(name: string, error: unknown): Step {
  return {
    name,
    run() {
      throw error;
    },
  };
}
