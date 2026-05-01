/**
 * SinwanJS Core Runtime — ErrorHandler
 *
 * Centralized error normalization and response generation.
 * Converts any thrown value into a consistent JSON error response.
 *
 * In production mode (NODE_ENV === "production"), stack traces
 * and internal details are stripped from responses.
 */

import type { Context } from "./context";
import type { ErrorPayload } from "./types";

/** Optional hook for external logging/telemetry integration. */
export type ErrorHook = (error: unknown, ctx: Context) => void | Promise<void>;

export class ErrorHandler {
  private readonly onError?: ErrorHook;

  constructor(options?: { onError?: ErrorHook }) {
    this.onError = options?.onError;
  }

  /**
   * Handle an error: normalize it, invoke the optional hook,
   * and set a JSON error response if none has been sent yet.
   */
  async handle(error: unknown, ctx: Context): Promise<void> {
    const payload = this.normalize(error);

    // Fire optional logging/telemetry hook
    if (this.onError) {
      try {
        await this.onError(error, ctx);
      } catch {
        // Hook errors must not prevent error response delivery
      }
    }

    // Only set a response if one hasn't been sent already
    if (!ctx.hasResponded()) {
      const status = payload.statusCode ?? 500;
      ctx.json({ error: payload.message }, status);
    }
  }

  /**
   * Normalize any thrown value into a consistent ErrorPayload.
   * Production mode suppresses internal error details.
   */
  private normalize(error: unknown): ErrorPayload {
    const isProduction = process.env.NODE_ENV === "production";

    // Standard Error instances
    if (error instanceof Error) {
      const statusCode = hasStatusCode(error) ? error.statusCode : undefined;
      return {
        message: isProduction ? "Internal Server Error" : error.message,
        statusCode,
      };
    }

    // Plain string throws
    if (typeof error === "string") {
      return {
        message: isProduction ? "Internal Server Error" : error,
      };
    }

    // Object with a message property (e.g., { message: "...", statusCode: 400 })
    if (isErrorLike(error)) {
      return {
        message: isProduction ? "Internal Server Error" : error.message,
        statusCode: typeof error.statusCode === "number"
          ? error.statusCode
          : undefined,
      };
    }

    // Completely unknown type
    return { message: "Internal Server Error" };
  }
}

// ─── Type Guards ──────────────────────────────────────────

interface ErrorLike {
  message: string;
  statusCode?: unknown;
}

function isErrorLike(value: unknown): value is ErrorLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof (value as ErrorLike).message === "string"
  );
}

function hasStatusCode(
  error: Error,
): error is Error & { statusCode: number } {
  return (
    "statusCode" in error &&
    typeof (error as Error & { statusCode: unknown }).statusCode === "number"
  );
}
