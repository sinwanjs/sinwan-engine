import { Context, type ContextOptions } from "../src/context/context";
import { EventBus, type EventBusOptions } from "../src/event-bus";
import { ErrorHandler, type ErrorHandlerOptions } from "../src/error-handler";

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
