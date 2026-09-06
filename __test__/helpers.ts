import { HttpContext } from "../src/context/http-context";
import type { ContextOptions } from "../src/context/base-context";
import { EventBus, type EventBusOptions } from "../src/event-bus";
import { ErrorHandler, type ErrorHandlerOptions } from "../src/error-handler";

/**
 * Create a real EventBus instance for testing.
 */
export function createTestBus(options?: EventBusOptions): EventBus {
  return new EventBus(options);
}

/**
 * Create a real HttpContext instance for testing.
 * The HttpContext is backed by a real ErrorHandler and optionally a real EventBus.
 */
export function createTestContext(
  bus?: EventBus,
  overrides?: Partial<ContextOptions>,
): HttpContext {
  const errorHandler = new ErrorHandler();
  return new HttpContext({
    bus,
    errorHandler,
    ...overrides,
  });
}
