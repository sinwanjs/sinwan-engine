import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import {
  ErrorNormalizer,
  type ErrorHook,
  type ErrorNormalizerOptions,
} from "../src/error-normalizer";
import type { Context } from "../src/context/context";
import type { ErrorPayload } from "../src/types";

const originalNodeEnv = process.env.NODE_ENV;

function setEnv(env: string | undefined): void {
  if (env === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = env;
  }
}

describe("ErrorNormalizer", () => {
  afterEach(() => {
    setEnv(originalNodeEnv);
  });

  // ─── Constructor ─────────────────────────────────────────

  describe("constructor", () => {
    test("creates instance with default options", () => {
      const n = new ErrorNormalizer();
      expect(n).toBeInstanceOf(ErrorNormalizer);
    });

    test("creates instance with options", () => {
      const hook: ErrorHook = () => {};
      const n = new ErrorNormalizer({
        onError: hook,
        includeStackInDev: false,
      });
      expect(n).toBeInstanceOf(ErrorNormalizer);
    });

    test("creates instance with partial options", () => {
      const n = new ErrorNormalizer({ includeStackInDev: false });
      expect(n).toBeInstanceOf(ErrorNormalizer);
    });
  });

  // ─── normalize — Error instances ─────────────────────────

  describe("normalize() — Error instances", () => {
    test("returns error message in development", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const result = n.normalize(new Error("test error"));
      expect(result.message).toBe("test error");
    });

    test("masks message in production", () => {
      setEnv("production");
      const n = new ErrorNormalizer();
      const result = n.normalize(new Error("test error"));
      expect(result.message).toBe("Internal Server Error");
    });

    test("shows message in production when showMessageInProduction=true", () => {
      setEnv("production");
      const n = new ErrorNormalizer();
      const result = n.normalize(new Error("test error"), true);
      expect(result.message).toBe("test error");
    });

    test("includes stack in development", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const err = new Error("test");
      const result = n.normalize(err);
      expect(result.stack).toBe(err.stack);
    });

    test("excludes stack in production", () => {
      setEnv("production");
      const n = new ErrorNormalizer();
      const result = n.normalize(new Error("test"));
      expect(result.stack).toBeUndefined();
    });

    test("excludes stack when includeStackInDev=false", () => {
      setEnv("development");
      const n = new ErrorNormalizer({ includeStackInDev: false });
      const result = n.normalize(new Error("test"));
      expect(result.stack).toBeUndefined();
    });

    test("extracts statusCode from error", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const err = new Error("Not Found") as Error & { statusCode: number };
      err.statusCode = 404;
      const result = n.normalize(err);
      expect(result.statusCode).toBe(404);
    });

    test("statusCode is undefined when not present", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const result = n.normalize(new Error("test"));
      expect(result.statusCode).toBeUndefined();
    });

    test("statusCode is undefined when not a number", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const err = new Error("test") as Error & { statusCode: string };
      err.statusCode = "500";
      const result = n.normalize(err);
      expect(result.statusCode).toBeUndefined();
    });
  });

  // ─── normalize — string errors ───────────────────────────

  describe("normalize() — string errors", () => {
    test("returns string message in development", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const result = n.normalize("something went wrong");
      expect(result.message).toBe("something went wrong");
    });

    test("masks string message in production", () => {
      setEnv("production");
      const n = new ErrorNormalizer();
      const result = n.normalize("something went wrong");
      expect(result.message).toBe("Internal Server Error");
    });

    test("shows string message in production when showMessageInProduction=true", () => {
      setEnv("production");
      const n = new ErrorNormalizer();
      const result = n.normalize("something went wrong", true);
      expect(result.message).toBe("something went wrong");
    });

    test("string errors have no statusCode", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const result = n.normalize("error");
      expect(result.statusCode).toBeUndefined();
    });

    test("string errors have no stack", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const result = n.normalize("error");
      expect(result.stack).toBeUndefined();
    });
  });

  // ─── normalize — error-like objects ──────────────────────

  describe("normalize() — error-like objects", () => {
    test("returns message in development", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const result = n.normalize({ message: "custom error", statusCode: 418 });
      expect(result.message).toBe("custom error");
    });

    test("masks message in production", () => {
      setEnv("production");
      const n = new ErrorNormalizer();
      const result = n.normalize({ message: "custom error" });
      expect(result.message).toBe("Internal Server Error");
    });

    test("shows message in production when showMessageInProduction=true", () => {
      setEnv("production");
      const n = new ErrorNormalizer();
      const result = n.normalize({ message: "custom error" }, true);
      expect(result.message).toBe("custom error");
    });

    test("extracts numeric statusCode", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const result = n.normalize({ message: "err", statusCode: 400 });
      expect(result.statusCode).toBe(400);
    });

    test("statusCode undefined when not a number", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const result = n.normalize({ message: "err", statusCode: "400" });
      expect(result.statusCode).toBeUndefined();
    });

    test("statusCode undefined when not present", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const result = n.normalize({ message: "err" });
      expect(result.statusCode).toBeUndefined();
    });

    test("error-like with non-string message is not matched", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const result = n.normalize({ message: 123 });
      expect(result.message).toBe("Internal Server Error");
    });
  });

  // ─── normalize — fallback ────────────────────────────────

  describe("normalize() — fallback for unknown types", () => {
    test("returns generic message for null", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const result = n.normalize(null);
      expect(result.message).toBe("Internal Server Error");
    });

    test("returns generic message for undefined", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const result = n.normalize(undefined);
      expect(result.message).toBe("Internal Server Error");
    });

    test("returns generic message for number", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const result = n.normalize(42);
      expect(result.message).toBe("Internal Server Error");
    });

    test("returns generic message for object without message", () => {
      setEnv("development");
      const n = new ErrorNormalizer();
      const result = n.normalize({ code: 500 });
      expect(result.message).toBe("Internal Server Error");
    });

    test("returns generic message for null in production", () => {
      setEnv("production");
      const n = new ErrorNormalizer();
      const result = n.normalize(null);
      expect(result.message).toBe("Internal Server Error");
    });
  });

  // ─── normalize — default NODE_ENV ────────────────────────

  describe("normalize() — default NODE_ENV", () => {
    test("treats undefined NODE_ENV as non-production", () => {
      setEnv(undefined);
      const n = new ErrorNormalizer();
      const result = n.normalize(new Error("visible"));
      expect(result.message).toBe("visible");
    });
  });

  // ─── report ──────────────────────────────────────────────

  describe("report()", () => {
    test("does nothing when no hook is set", async () => {
      const n = new ErrorNormalizer();
      await expect(n.report(new Error("test"))).resolves.toBeUndefined();
    });

    test("calls hook with error and context", async () => {
      let receivedError: unknown;
      let receivedCtx: unknown;
      const hook: ErrorHook = (err, ctx) => {
        receivedError = err;
        receivedCtx = ctx;
      };
      const n = new ErrorNormalizer({ onError: hook });
      const ctx = {} as Context;
      await n.report(new Error("test"), ctx);
      expect(receivedError).toBeInstanceOf(Error);
      expect((receivedError as Error).message).toBe("test");
      expect(receivedCtx).toBe(ctx);
    });

    test("calls hook with error and undefined context", async () => {
      let receivedCtx: unknown;
      const hook: ErrorHook = (_err, ctx) => {
        receivedCtx = ctx;
      };
      const n = new ErrorNormalizer({ onError: hook });
      await n.report(new Error("test"));
      expect(receivedCtx).toBeUndefined();
    });

    test("async hook is awaited", async () => {
      let hookCalled = false;
      const hook: ErrorHook = async () => {
        await new Promise((r) => setTimeout(r, 10));
        hookCalled = true;
      };
      const n = new ErrorNormalizer({ onError: hook });
      await n.report(new Error("test"));
      expect(hookCalled).toBe(true);
    });

    test("hook errors are caught and logged, not propagated", async () => {
      const consoleSpy = mock((..._args: unknown[]) => {});
      const originalError = console.error;
      console.error = consoleSpy;

      const hook: ErrorHook = () => {
        throw new Error("hook failure");
      };
      const n = new ErrorNormalizer({ onError: hook });
      await expect(n.report(new Error("test"))).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();

      console.error = originalError;
    });

    test("async hook that rejects is caught", async () => {
      const consoleSpy = mock((..._args: unknown[]) => {});
      const originalError = console.error;
      console.error = consoleSpy;

      const hook: ErrorHook = async () => {
        throw new Error("async hook failure");
      };
      const n = new ErrorNormalizer({ onError: hook });
      await expect(n.report(new Error("test"))).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();

      console.error = originalError;
    });
  });
});
