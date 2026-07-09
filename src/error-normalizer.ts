/**
 * SinwanJS Core Runtime — ErrorNormalizer
 *
 * Shared error normalization used by all protocol routers.
 * Converts any thrown value into a consistent ErrorPayload with
 * production safety (stack stripping, message masking) and an
 * optional telemetry hook.
 *
 * ErrorHandler (HTTP/WS) wraps this class and adds response formatting.
 * TCP, UDP, and gRPC routers use this directly for normalization and
 * telemetry without HTTP-specific response building.
 */

import type { Context } from "./context/context";
import type { ErrorPayload } from "./types";

/** Optional hook for external logging/telemetry integration. */
export type ErrorHook = (error: unknown, ctx?: Context) => void | Promise<void>;

/** Options for configuring the ErrorNormalizer. */
export interface ErrorNormalizerOptions {
  /** Hook invoked with the raw error for logging/telemetry. */
  onError?: ErrorHook;
  /** Include stack traces in development mode (default: true). */
  includeStackInDev?: boolean;
}

export class ErrorNormalizer {
  private readonly onError?: ErrorHook;
  private readonly includeStackInDev: boolean;

  constructor(options?: ErrorNormalizerOptions) {
    this.onError = options?.onError;
    this.includeStackInDev = options?.includeStackInDev ?? true;
  }

  /**
   * Normalize any thrown value into a consistent ErrorPayload.
   * Production mode suppresses internal error details.
   */
  normalize(
    error: unknown,
    showMessageInProduction: boolean = false,
  ): ErrorPayload {
    const isProduction = process.env.NODE_ENV === "production";

    if (error instanceof Error) {
      const statusCode = hasStatusCode(error) ? error.statusCode : undefined;
      const stack =
        !isProduction && this.includeStackInDev ? error.stack : undefined;
      return {
        message: showMessageInProduction
          ? error.message
          : isProduction
            ? "Internal Server Error"
            : error.message,
        statusCode,
        stack,
      };
    }

    if (typeof error === "string") {
      return {
        message: showMessageInProduction
          ? error
          : isProduction
            ? "Internal Server Error"
            : error,
      };
    }

    if (isErrorLike(error)) {
      return {
        message: showMessageInProduction
          ? error.message
          : isProduction
            ? "Internal Server Error"
            : error.message,
        statusCode:
          typeof error.statusCode === "number" ? error.statusCode : undefined,
      };
    }

    return { message: "Internal Server Error" };
  }

  /**
   * Invoke the optional telemetry hook with the raw error.
   * Hook errors are logged but never propagated.
   */
  async report(error: unknown, ctx?: Context): Promise<void> {
    if (!this.onError) return;
    try {
      await this.onError(error, ctx);
    } catch (hookError) {
      console.error("[ErrorNormalizer] Hook error:", hookError);
    }
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

function hasStatusCode(error: Error): error is Error & { statusCode: number } {
  return (
    "statusCode" in error &&
    typeof (error as Error & { statusCode: unknown }).statusCode === "number"
  );
}
