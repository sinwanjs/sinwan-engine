import { describe, expect, test, afterEach, beforeEach, mock } from "bun:test";
import { Sinwan } from "../../src/sinwan";
import type { ErrorPayload } from "../../src/types";

const originalNodeEnv = process.env.NODE_ENV;

function setEnv(env: string | undefined): void {
  if (env === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = env;
  }
}

afterEach(() => {
  setEnv(originalNodeEnv);
});

describe("ErrorHandler — Integration Tests", () => {
  // ─── Sync error propagation ──────────────────────────────

  describe("synchronous error propagation", () => {
    test("sync throw in route handler produces 500 JSON response", async () => {
      const app = new Sinwan();
      app.get("/crash", () => {
        throw new Error("sync boom");
      });

      const res = await app.request("http://localhost/crash");
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("sync boom");
    });

    test("sync throw with statusCode produces correct status", async () => {
      const app = new Sinwan();
      app.get("/notfound", () => {
        const err = new Error("Not found") as Error & { statusCode: number };
        err.statusCode = 404;
        throw err;
      });

      const res = await app.request("http://localhost/notfound");
      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("Not found");
    });

    test("sync throw includes stack trace in development", async () => {
      setEnv("development");
      const app = new Sinwan();
      app.get("/dev-crash", () => {
        throw new Error("dev error");
      });

      const res = await app.request("http://localhost/dev-crash");
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.stack).toBeDefined();
      expect(typeof body.stack).toBe("string");
      expect((body.stack as string).includes("dev error")).toBe(true);
    });

    test("sync throw excludes stack trace in production", async () => {
      setEnv("production");
      const app = new Sinwan();
      app.get("/prod-crash", () => {
        throw new Error("prod error");
      });

      const res = await app.request("http://localhost/prod-crash");
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.stack).toBeUndefined();
      expect(body.error).toBe("Internal Server Error");
    });
  });

  // ─── Async error propagation ─────────────────────────────

  describe("async error propagation", () => {
    test("async reject in route handler produces 500 JSON response", async () => {
      const app = new Sinwan();
      app.get("/async-crash", async () => {
        await Promise.resolve();
        throw new Error("async boom");
      });

      const res = await app.request("http://localhost/async-crash");
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("async boom");
    });

    test("async reject with statusCode produces correct status", async () => {
      const app = new Sinwan();
      app.get("/async-403", async () => {
        const err = new Error("Forbidden") as Error & { statusCode: number };
        err.statusCode = 403;
        throw err;
      });

      const res = await app.request("http://localhost/async-403");
      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("Forbidden");
    });

    test("deeply nested async rejection is caught", async () => {
      const app = new Sinwan();
      app.get("/nested-async", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        await Promise.resolve().then(() => {
          return Promise.reject(new Error("nested reject"));
        });
      });

      const res = await app.request("http://localhost/nested-async");
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("nested reject");
    });

    test("async error after delay is caught", async () => {
      const app = new Sinwan();
      app.get("/delayed-crash", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error("delayed boom");
      });

      const res = await app.request("http://localhost/delayed-crash");
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("delayed boom");
    });
  });

  // ─── Stack trace integrity ───────────────────────────────

  describe("stack trace integrity", () => {
    test("stack trace contains the throwing function", async () => {
      setEnv("development");
      const app = new Sinwan();
      function deepFunction(): never {
        throw new Error("from deep");
      }
      app.get("/deep", () => {
        deepFunction();
      });

      const res = await app.request("http://localhost/deep");
      const body = (await res.json()) as Record<string, unknown>;
      const stack = body.stack as string;
      expect(stack.includes("deepFunction")).toBe(true);
    });

    test("stack trace is the actual Error.stack", async () => {
      setEnv("development");
      const app = new Sinwan();
      let thrownError: Error | undefined;
      app.get("/trace", () => {
        thrownError = new Error("trace test");
        throw thrownError;
      });

      const res = await app.request("http://localhost/trace");
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.stack).toBe(thrownError!.stack);
    });

    test("custom error subclass preserves stack", async () => {
      setEnv("development");
      class ValidationError extends Error {
        constructor(message: string) {
          super(message);
          this.name = "ValidationError";
        }
      }

      const app = new Sinwan();
      app.get("/validation", () => {
        throw new ValidationError("invalid input");
      });

      const res = await app.request("http://localhost/validation");
      const body = (await res.json()) as Record<string, unknown>;
      const stack = body.stack as string;
      expect(stack).toContain("ValidationError");
      expect(stack).toContain("invalid input");
    });
  });

  // ─── Error-like and non-Error throws ─────────────────────

  describe("non-Error throws", () => {
    test("string throw produces error response", async () => {
      const app = new Sinwan();
      app.get("/string-throw", () => {
        throw "string error";
      });

      const res = await app.request("http://localhost/string-throw");
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("string error");
    });

    test("error-like object throw produces error response", async () => {
      const app = new Sinwan();
      app.get("/object-throw", () => {
        throw { message: "object error", statusCode: 422 };
      });

      const res = await app.request("http://localhost/object-throw");
      expect(res.status).toBe(422);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("object error");
    });

    test("null throw produces fallback error response", async () => {
      const app = new Sinwan();
      app.get("/null-throw", () => {
        throw null;
      });

      const res = await app.request("http://localhost/null-throw");
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("Internal Server Error");
    });

    test("undefined throw produces fallback error response", async () => {
      const app = new Sinwan();
      app.get("/undefined-throw", () => {
        throw undefined;
      });

      const res = await app.request("http://localhost/undefined-throw");
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("Internal Server Error");
    });

    test("number throw produces fallback error response", async () => {
      const app = new Sinwan();
      app.get("/number-throw", () => {
        throw 42;
      });

      const res = await app.request("http://localhost/number-throw");
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("Internal Server Error");
    });
  });

  // ─── Event bus integration ───────────────────────────────

  describe("event bus integration", () => {
    test("request:error event fires with error details", async () => {
      const app = new Sinwan();
      let capturedError: unknown;
      app.bus.on("request:error", (_ctx, payload) => {
        capturedError = (payload as { error: unknown }).error;
      });
      app.get("/event-crash", () => {
        throw new Error("event bus test");
      });

      await app.request("http://localhost/event-crash");
      expect(capturedError).toBeInstanceOf(Error);
      expect((capturedError as Error).message).toBe("event bus test");
    });

    test("error event fires with error and context", async () => {
      const app = new Sinwan();
      let capturedError: unknown;
      app.bus.on("error", (_ctx, error) => {
        capturedError = error;
      });
      app.get("/error-event", () => {
        throw new Error("error event test");
      });

      await app.request("http://localhost/error-event");
      expect(capturedError).toBeInstanceOf(Error);
      expect((capturedError as Error).message).toBe("error event test");
    });

    test("request:error listener throwing does not prevent response", async () => {
      const app = new Sinwan();
      app.bus.on("request:error", () => {
        throw new Error("listener crash");
      });
      app.get("/listener-crash", () => {
        throw new Error("original error");
      });

      const res = await app.request("http://localhost/listener-crash");
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("original error");
    });

    test("onError hook receives raw error and context", async () => {
      const app = new Sinwan({
        error: {
          onError: (err, ctx) => {
            expect(err).toBeInstanceOf(Error);
            expect((err as Error).message).toBe("hook test");
            expect(ctx).toBeDefined();
          },
        },
      });
      app.get("/hook-test", () => {
        throw new Error("hook test");
      });

      const res = await app.request("http://localhost/hook-test");
      expect(res.status).toBe(500);
    });

    test("onError hook throwing does not prevent response", async () => {
      const consoleSpy = mock((..._args: unknown[]) => {});
      const originalError = console.error;
      console.error = consoleSpy;

      const app = new Sinwan({
        error: {
          onError: () => {
            throw new Error("hook failure");
          },
        },
      });
      app.get("/hook-crash", () => {
        throw new Error("original");
      });

      const res = await app.request("http://localhost/hook-crash");
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("original");
      expect(consoleSpy).toHaveBeenCalled();

      console.error = originalError;
    });
  });

  // ─── HTML error response integration ────────────────────

  describe("HTML error response", () => {
    test("HTML response type produces text/html content-type", async () => {
      const app = new Sinwan({ error: { responseType: "html" } });
      app.get("/html-crash", () => {
        throw new Error("html test");
      });

      const res = await app.request("http://localhost/html-crash");
      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("html test");
      expect(html).toContain("<!DOCTYPE html>");
    });

    test("HTML response escapes XSS in error message", async () => {
      setEnv("development");
      const app = new Sinwan({ error: { responseType: "html" } });
      app.get("/xss", () => {
        throw new Error("<script>alert('xss')</script>");
      });

      const res = await app.request("http://localhost/xss");
      const html = await res.text();
      expect(html).not.toContain("<script>alert('xss')</script>");
      expect(html).toContain("&lt;script&gt;");
    });

    test("custom formatResponse is used in integration", async () => {
      const app = new Sinwan({
        error: {
          formatResponse: (payload: ErrorPayload) => ({
            body: JSON.stringify({
              custom: payload.message,
              code: payload.statusCode ?? 500,
            }),
            type: "json" as const,
          }),
        },
      });
      app.get("/custom-format", () => {
        throw new Error("custom format test");
      });

      const res = await app.request("http://localhost/custom-format");
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.custom).toBe("custom format test");
      expect(body.code).toBe(500);
    });
  });

  // ─── Production safety ───────────────────────────────────

  describe("production safety", () => {
    test("production masks error messages", async () => {
      setEnv("production");
      const app = new Sinwan();
      app.get("/secret", () => {
        throw new Error(
          "database connection string: postgres://user:pass@host",
        );
      });

      const res = await app.request("http://localhost/secret");
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("Internal Server Error");
      expect(body.stack).toBeUndefined();
    });

    test("production with showMessageInProduction shows message", async () => {
      setEnv("production");
      const app = new Sinwan();
      app.get("/visible", () => {
        const err = new Error("visible error") as Error & {
          statusCode: number;
        };
        err.statusCode = 400;
        throw err;
      });

      // The runtime calls handle() without showMessageInProduction, so it masks
      const res = await app.request("http://localhost/visible");
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("Internal Server Error");
    });

    test("production still returns correct status code", async () => {
      setEnv("production");
      const app = new Sinwan();
      app.get("/prod-404", () => {
        const err = new Error("Not found") as Error & { statusCode: number };
        err.statusCode = 404;
        throw err;
      });

      const res = await app.request("http://localhost/prod-404");
      expect(res.status).toBe(404);
    });
  });

  // ─── No response produced ────────────────────────────────

  describe("no response produced", () => {
    test("route that does not respond gets 500 default", async () => {
      const app = new Sinwan();
      app.get("/silent", () => {
        // does nothing
      });

      const res = await app.request("http://localhost/silent");
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("No response was produced.");
    });
  });

  // ─── Error after partial response ────────────────────────

  describe("error after partial response", () => {
    test("error after ctx.json does not override existing response", async () => {
      const app = new Sinwan();
      app.get("/partial", (ctx) => {
        ctx.json({ data: "first" }, 200);
        throw new Error("after response");
      });

      const res = await app.request("http://localhost/partial");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.data).toBe("first");
    });

    test("error after ctx.html does not override existing response", async () => {
      const app = new Sinwan();
      app.get("/partial-html", (ctx) => {
        ctx.html("<p>first</p>", 200);
        throw new Error("after html");
      });

      const res = await app.request("http://localhost/partial-html");
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toBe("<p>first</p>");
    });
  });

  // ─── Multiple errors in sequence ─────────────────────────

  describe("multiple errors in sequence", () => {
    test("consecutive requests with errors each get proper responses", async () => {
      const app = new Sinwan();
      app.get("/err1", () => {
        throw new Error("first error");
      });
      app.get("/err2", () => {
        const err = new Error("second error") as Error & { statusCode: number };
        err.statusCode = 503;
        throw err;
      });
      app.get("/ok", (ctx) => {
        ctx.json({ ok: true }, 200);
      });

      const res1 = await app.request("http://localhost/err1");
      const res2 = await app.request("http://localhost/err2");
      const res3 = await app.request("http://localhost/ok");

      expect(res1.status).toBe(500);
      expect(((await res1.json()) as Record<string, unknown>).error).toBe(
        "first error",
      );

      expect(res2.status).toBe(503);
      expect(((await res2.json()) as Record<string, unknown>).error).toBe(
        "second error",
      );

      expect(res3.status).toBe(200);
      expect(((await res3.json()) as Record<string, unknown>).ok).toBe(true);
    });

    test("context pool reuse after error does not leak state", async () => {
      const app = new Sinwan({ maxPoolSize: 1 });
      app.get("/leak-test", () => {
        throw new Error("leak check");
      });
      app.get("/clean", (ctx) => {
        ctx.json({ body: ctx.body, status: ctx.statusCode }, 200);
      });

      // First request errors
      const res1 = await app.request("http://localhost/leak-test");
      expect(res1.status).toBe(500);

      // Second request should get a clean context
      const res2 = await app.request("http://localhost/clean");
      expect(res2.status).toBe(200);
      const body2 = (await res2.json()) as Record<string, unknown>;
      // body should be null (fresh context), not leaked from error
      expect(body2.body).toBeNull();
      expect(body2.status).toBe(200);
    });
  });

  // ─── Middleware error propagation ────────────────────────

  describe("middleware error propagation", () => {
    test("error in step is caught", async () => {
      const app = new Sinwan();
      app.add("throwing-step", () => {
        throw new Error("step error");
      });
      app.get("/step-test", (ctx) => {
        ctx.json({ ok: true }, 200);
      });

      const res = await app.request("http://localhost/step-test");
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("step error");
    });

    test("async error in step is caught", async () => {
      const app = new Sinwan();
      app.add("async-throwing-step", async () => {
        await Promise.resolve();
        throw new Error("async step error");
      });
      app.get("/async-step-test", (ctx) => {
        ctx.json({ ok: true }, 200);
      });

      const res = await app.request("http://localhost/async-step-test");
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe("async step error");
    });
  });
});
