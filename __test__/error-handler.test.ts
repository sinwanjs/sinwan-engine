import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import {
  ErrorHandler,
  HTTP_STATUS_LABELS,
  type ErrorHandlerOptions,
  type ErrorResponseFormatter,
  type ErrorResponseType,
} from "../src/error-handler";
import { ErrorNormalizer, type ErrorHook } from "../src/error-normalizer";
import { Context, type ContextOptions } from "../src/context/context";
import { EventBus } from "../src/event-bus";
import type { ErrorPayload } from "../src/types";

const originalNodeEnv = process.env.NODE_ENV;

function setEnv(env: string | undefined): void {
  if (env === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = env;
  }
}

function createCtx(): Context {
  const bus = new EventBus();
  const handler = new ErrorHandler();
  return new Context({ bus, errorHandler: handler });
}

describe("ErrorHandler", () => {
  afterEach(() => {
    setEnv(originalNodeEnv);
  });

  // ─── Constructor ─────────────────────────────────────────

  describe("constructor", () => {
    test("creates instance with default options", () => {
      const h = new ErrorHandler();
      expect(h).toBeInstanceOf(ErrorHandler);
    });

    test("creates instance with responseType option", () => {
      const h = new ErrorHandler({ responseType: "html" });
      expect(h).toBeInstanceOf(ErrorHandler);
    });

    test("creates instance with formatResponse option", () => {
      const formatter: ErrorResponseFormatter = (payload) => ({
        body: JSON.stringify({ error: payload.message }),
        type: "json",
      });
      const h = new ErrorHandler({ formatResponse: formatter });
      expect(h).toBeInstanceOf(ErrorHandler);
    });

    test("creates instance with onError hook", () => {
      const hook: ErrorHook = () => {};
      const h = new ErrorHandler({ onError: hook });
      expect(h).toBeInstanceOf(ErrorHandler);
    });

    test("creates instance with includeStackInDev option", () => {
      const h = new ErrorHandler({ includeStackInDev: false });
      expect(h).toBeInstanceOf(ErrorHandler);
    });
  });

  // ─── normalizer getter ───────────────────────────────────

  describe("normalizer getter", () => {
    test("returns the internal ErrorNormalizer instance", () => {
      const h = new ErrorHandler();
      const n = h.normalizer;
      expect(n).toBeInstanceOf(ErrorNormalizer);
    });

    test("normalizer is the same instance across calls", () => {
      const h = new ErrorHandler();
      expect(h.normalizer).toBe(h.normalizer);
    });
  });

  // ─── handle() — JSON response (default) ──────────────────

  describe("handle() — JSON response (default)", () => {
    test("sets JSON error response with message", async () => {
      setEnv("development");
      const ctx = createCtx();
      const handler = new ErrorHandler();
      await handler.handle(new Error("test error"), ctx);
      expect(ctx.hasResponded()).toBe(true);
      expect(ctx.statusCode).toBe(500);
      const body = ctx.body as Record<string, unknown>;
      expect(body.error).toBe("test error");
      expect(typeof body.stack).toBe("string");
    });

    test("uses statusCode from error", async () => {
      setEnv("development");
      const ctx = createCtx();
      const handler = new ErrorHandler();
      const err = new Error("Not Found") as Error & { statusCode: number };
      err.statusCode = 404;
      await handler.handle(err, ctx);
      expect(ctx.statusCode).toBe(404);
    });

    test("defaults to 500 when no statusCode", async () => {
      setEnv("development");
      const ctx = createCtx();
      const handler = new ErrorHandler();
      await handler.handle(new Error("test"), ctx);
      expect(ctx.statusCode).toBe(500);
    });

    test("includes stack in JSON response in development", async () => {
      setEnv("development");
      const ctx = createCtx();
      const handler = new ErrorHandler();
      const err = new Error("test");
      await handler.handle(err, ctx);
      const body = ctx.body as Record<string, unknown>;
      expect(body.stack).toBe(err.stack);
    });

    test("excludes stack in JSON response in production", async () => {
      setEnv("production");
      const ctx = createCtx();
      const handler = new ErrorHandler();
      await handler.handle(new Error("test"), ctx);
      const body = ctx.body as Record<string, unknown>;
      expect(body.stack).toBeUndefined();
    });

    test("masks message in production", async () => {
      setEnv("production");
      const ctx = createCtx();
      const handler = new ErrorHandler();
      await handler.handle(new Error("sensitive info"), ctx);
      const body = ctx.body as Record<string, unknown>;
      expect(body.error).toBe("Internal Server Error");
    });

    test("shows message in production when showMessageInProduction=true", async () => {
      setEnv("production");
      const ctx = createCtx();
      const handler = new ErrorHandler();
      await handler.handle(new Error("visible error"), ctx, true);
      const body = ctx.body as Record<string, unknown>;
      expect(body.error).toBe("visible error");
    });
  });

  // ─── handle() — HTML response ────────────────────────────

  describe("handle() — HTML response", () => {
    test("sets HTML error response", async () => {
      setEnv("development");
      const ctx = createCtx();
      const handler = new ErrorHandler({ responseType: "html" });
      await handler.handle(new Error("test error"), ctx);
      expect(ctx.hasResponded()).toBe(true);
      expect(ctx.statusCode).toBe(500);
      expect(typeof ctx.body).toBe("string");
      expect(ctx.body as string).toContain("test error");
    });

    test("HTML response contains status code and label", async () => {
      setEnv("development");
      const ctx = createCtx();
      const handler = new ErrorHandler({ responseType: "html" });
      const err = new Error("Not Found") as Error & { statusCode: number };
      err.statusCode = 404;
      await handler.handle(err, ctx);
      const html = ctx.body as string;
      expect(html).toContain("404");
      expect(html).toContain("Not Found");
    });

    test("HTML response contains stack trace in development", async () => {
      setEnv("development");
      const ctx = createCtx();
      const handler = new ErrorHandler({ responseType: "html" });
      const err = new Error("test");
      await handler.handle(err, ctx);
      const html = ctx.body as string;
      expect(html).toContain("Stack trace");
      expect(html).toContain("development");
    });

    test("HTML response excludes stack trace in production", async () => {
      setEnv("production");
      const ctx = createCtx();
      const handler = new ErrorHandler({ responseType: "html" });
      await handler.handle(new Error("test"), ctx);
      const html = ctx.body as string;
      expect(html).not.toContain("Stack trace");
      expect(html).not.toContain("development");
    });

    test("HTML response uses unknown status label for non-standard codes", async () => {
      setEnv("development");
      const ctx = createCtx();
      const handler = new ErrorHandler({ responseType: "html" });
      const err = new Error("test") as Error & { statusCode: number };
      err.statusCode = 599;
      await handler.handle(err, ctx);
      const html = ctx.body as string;
      expect(html).toContain("599");
      expect(html).toContain("Error");
    });

    test("HTML response escapes HTML in message", async () => {
      setEnv("development");
      const ctx = createCtx();
      const handler = new ErrorHandler({ responseType: "html" });
      await handler.handle(new Error("<script>alert('xss')</script>"), ctx);
      const html = ctx.body as string;
      expect(html).not.toContain("<script>alert('xss')</script>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("&lt;/script&gt;");
    });

    test("HTML response escapes HTML in stack trace", async () => {
      setEnv("development");
      const ctx = createCtx();
      const handler = new ErrorHandler({ responseType: "html" });
      const err = new Error("test");
      err.stack = "Error: test\n    at <script>file:1:1</script>";
      await handler.handle(err, ctx);
      const html = ctx.body as string;
      expect(html).toContain("&lt;script&gt;");
    });

    test("HTML response contains DOCTYPE and html tags", async () => {
      setEnv("development");
      const ctx = createCtx();
      const handler = new ErrorHandler({ responseType: "html" });
      await handler.handle(new Error("test"), ctx);
      const html = ctx.body as string;
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html");
      expect(html).toContain("</html>");
    });

    test("HTML response contains SinwanJS branding", async () => {
      setEnv("development");
      const ctx = createCtx();
      const handler = new ErrorHandler({ responseType: "html" });
      await handler.handle(new Error("test"), ctx);
      const html = ctx.body as string;
      expect(html).toContain("Sinwan");
    });

    test("HTML response contains timestamp", async () => {
      setEnv("development");
      const ctx = createCtx();
      const handler = new ErrorHandler({ responseType: "html" });
      await handler.handle(new Error("test"), ctx);
      const html = ctx.body as string;
      expect(html).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ─── handle() — custom formatResponse ────────────────────

  describe("handle() — custom formatResponse", () => {
    test("uses custom formatter for JSON response", async () => {
      setEnv("development");
      const ctx = createCtx();
      const formatter: ErrorResponseFormatter = (payload) => ({
        body: JSON.stringify({ customError: payload.message }),
        type: "json",
      });
      const handler = new ErrorHandler({ formatResponse: formatter });
      await handler.handle(new Error("custom test"), ctx);
      expect(ctx.body).toEqual({ customError: "custom test" });
    });

    test("uses custom formatter for HTML response", async () => {
      setEnv("development");
      const ctx = createCtx();
      const formatter: ErrorResponseFormatter = (payload) => ({
        body: `<p>${payload.message}</p>`,
        type: "html",
      });
      const handler = new ErrorHandler({ formatResponse: formatter });
      await handler.handle(new Error("custom html"), ctx);
      expect(ctx.body).toBe("<p>custom html</p>");
    });

    test("falls back to { error: body } when JSON parse fails", async () => {
      setEnv("development");
      const ctx = createCtx();
      const formatter: ErrorResponseFormatter = () => ({
        body: "not valid json",
        type: "json",
      });
      const handler = new ErrorHandler({ formatResponse: formatter });
      await handler.handle(new Error("test"), ctx);
      expect(ctx.body).toEqual({ error: "not valid json" });
    });

    test("formatter receives payload and context", async () => {
      setEnv("development");
      const ctx = createCtx();
      let receivedPayload: ErrorPayload | undefined;
      let receivedCtx: Context | undefined;
      const formatter: ErrorResponseFormatter = (payload, c) => {
        receivedPayload = payload;
        receivedCtx = c;
        return {
          body: JSON.stringify({ error: payload.message }),
          type: "json",
        };
      };
      const handler = new ErrorHandler({ formatResponse: formatter });
      await handler.handle(new Error("test"), ctx);
      expect(receivedPayload?.message).toBe("test");
      expect(receivedCtx).toBe(ctx);
    });

    test("formatter uses statusCode from payload", async () => {
      setEnv("development");
      const ctx = createCtx();
      const formatter: ErrorResponseFormatter = (payload) => ({
        body: JSON.stringify({ error: payload.message }),
        type: "json",
      });
      const handler = new ErrorHandler({ formatResponse: formatter });
      const err = new Error("test") as Error & { statusCode: number };
      err.statusCode = 403;
      await handler.handle(err, ctx);
      expect(ctx.statusCode).toBe(403);
    });
  });

  // ─── handle() — does not override existing response ──────

  describe("handle() — does not override existing response", () => {
    test("skips response if already responded", async () => {
      setEnv("development");
      const ctx = createCtx();
      ctx.json({ data: "existing" }, 200);
      const handler = new ErrorHandler();
      await handler.handle(new Error("test"), ctx);
      expect(ctx.statusCode).toBe(200);
      expect(ctx.body).toEqual({ data: "existing" });
    });
  });

  // ─── handle() — onError hook ─────────────────────────────

  describe("handle() — onError hook", () => {
    test("invokes onError hook with error and context", async () => {
      setEnv("development");
      const ctx = createCtx();
      let hookError: unknown;
      let hookCtx: unknown;
      const hook: ErrorHook = (err, c) => {
        hookError = err;
        hookCtx = c;
      };
      const handler = new ErrorHandler({ onError: hook });
      await handler.handle(new Error("test"), ctx);
      expect(hookError).toBeInstanceOf(Error);
      expect(hookCtx).toBe(ctx);
    });

    test("hook error does not prevent response", async () => {
      setEnv("development");
      const ctx = createCtx();
      const consoleSpy = mock((..._args: unknown[]) => {});
      const originalError = console.error;
      console.error = consoleSpy;

      const hook: ErrorHook = () => {
        throw new Error("hook failure");
      };
      const handler = new ErrorHandler({ onError: hook });
      await handler.handle(new Error("test"), ctx);
      expect(ctx.hasResponded()).toBe(true);
      expect(consoleSpy).toHaveBeenCalled();

      console.error = originalError;
    });
  });

  // ─── handle() — string and error-like inputs ─────────────

  describe("handle() — various error types", () => {
    test("handles string errors", async () => {
      setEnv("development");
      const ctx = createCtx();
      const handler = new ErrorHandler();
      await handler.handle("string error", ctx);
      expect(ctx.body).toEqual({ error: "string error" });
    });

    test("handles error-like objects", async () => {
      setEnv("development");
      const ctx = createCtx();
      const handler = new ErrorHandler();
      await handler.handle({ message: "object error", statusCode: 400 }, ctx);
      expect(ctx.statusCode).toBe(400);
      expect(ctx.body).toEqual({ error: "object error" });
    });

    test("handles null with fallback message", async () => {
      setEnv("development");
      const ctx = createCtx();
      const handler = new ErrorHandler();
      await handler.handle(null, ctx);
      expect(ctx.body).toEqual({ error: "Internal Server Error" });
    });
  });

  // ─── HTTP_STATUS_LABELS ──────────────────────────────────

  describe("HTTP_STATUS_LABELS", () => {
    test("contains common status codes", () => {
      expect(HTTP_STATUS_LABELS[200]).toBe("OK");
      expect(HTTP_STATUS_LABELS[404]).toBe("Not Found");
      expect(HTTP_STATUS_LABELS[500]).toBe("Internal Server Error");
      expect(HTTP_STATUS_LABELS[403]).toBe("Forbidden");
      expect(HTTP_STATUS_LABELS[401]).toBe("Unauthorized");
    });

    test("contains all 4xx codes used by the engine", () => {
      expect(HTTP_STATUS_LABELS[400]).toBe("Bad Request");
      expect(HTTP_STATUS_LABELS[413]).toBe("Payload Too Large");
      expect(HTTP_STATUS_LABELS[415]).toBe("Unsupported Media Type");
      expect(HTTP_STATUS_LABELS[418]).toBe("I'm a teapot");
      expect(HTTP_STATUS_LABELS[429]).toBe("Too Many Requests");
    });

    test("contains 3xx redirect codes", () => {
      expect(HTTP_STATUS_LABELS[301]).toBe("Moved Permanently");
      expect(HTTP_STATUS_LABELS[302]).toBe("Found");
      expect(HTTP_STATUS_LABELS[307]).toBe("Temporary Redirect");
      expect(HTTP_STATUS_LABELS[308]).toBe("Permanent Redirect");
    });

    test("contains 5xx server error codes", () => {
      expect(HTTP_STATUS_LABELS[502]).toBe("Bad Gateway");
      expect(HTTP_STATUS_LABELS[503]).toBe("Service Unavailable");
      expect(HTTP_STATUS_LABELS[504]).toBe("Gateway Timeout");
    });
  });
});
