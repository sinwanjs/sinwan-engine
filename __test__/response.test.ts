import { describe, expect, test } from "bun:test";
import { buildResponse } from "../src/response";
import { Context, type ContextOptions } from "../src/context/context";
import { EventBus } from "../src/event-bus";
import { ErrorHandler } from "../src/error-handler";

function createCtx(overrides?: Partial<ContextOptions>): Context {
  return new Context({
    bus: new EventBus(),
    errorHandler: new ErrorHandler(),
    ...overrides,
  });
}

describe("buildResponse", () => {
  // ─── String body ─────────────────────────────────────────

  describe("string body", () => {
    test("returns Response with string body", async () => {
      const ctx = createCtx();
      ctx.body = "hello world";
      const res = buildResponse(ctx);
      expect(res).toBeInstanceOf(Response);
      expect(await res.text()).toBe("hello world");
    });

    test("uses context statusCode", () => {
      const ctx = createCtx();
      ctx.body = "created";
      ctx.statusCode = 201;
      const res = buildResponse(ctx);
      expect(res.status).toBe(201);
    });

    test("includes headers when set", () => {
      const ctx = createCtx();
      ctx.body = "text";
      ctx.setHeader("X-Custom", "value");
      const res = buildResponse(ctx);
      expect(res.headers.get("X-Custom")).toBe("value");
    });

    test("omits headers when none set", () => {
      const ctx = createCtx();
      ctx.body = "text";
      const res = buildResponse(ctx);
      expect(ctx.hasHeaders()).toBe(false);
    });

    test("empty string body", async () => {
      const ctx = createCtx();
      ctx.body = "";
      const res = buildResponse(ctx);
      expect(await res.text()).toBe("");
    });
  });

  // ─── null / undefined body ───────────────────────────────

  describe("null and undefined body", () => {
    test("null body returns empty Response", async () => {
      const ctx = createCtx();
      ctx.body = null;
      const res = buildResponse(ctx);
      expect(res).toBeInstanceOf(Response);
      expect(await res.text()).toBe("");
    });

    test("undefined body returns empty Response", async () => {
      const ctx = createCtx();
      ctx.body = undefined;
      const res = buildResponse(ctx);
      expect(res).toBeInstanceOf(Response);
      expect(await res.text()).toBe("");
    });

    test("null body with status code", () => {
      const ctx = createCtx();
      ctx.body = null;
      ctx.statusCode = 204;
      const res = buildResponse(ctx);
      expect(res.status).toBe(204);
    });

    test("null body with headers", () => {
      const ctx = createCtx();
      ctx.body = null;
      ctx.setHeader("X-Test", "yes");
      const res = buildResponse(ctx);
      expect(res.headers.get("X-Test")).toBe("yes");
    });
  });

  // ─── ReadableStream body ─────────────────────────────────

  describe("ReadableStream body", () => {
    test("returns Response with stream body", async () => {
      const ctx = createCtx();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("streamed data"));
          controller.close();
        },
      });
      ctx.body = stream;
      const res = buildResponse(ctx);
      expect(res).toBeInstanceOf(Response);
      expect(await res.text()).toBe("streamed data");
    });

    test("stream body with status code", () => {
      const ctx = createCtx();
      ctx.body = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });
      ctx.statusCode = 200;
      const res = buildResponse(ctx);
      expect(res.status).toBe(200);
    });
  });

  // ─── ArrayBuffer body ────────────────────────────────────

  describe("ArrayBuffer body", () => {
    test("returns Response with ArrayBuffer body", async () => {
      const ctx = createCtx();
      const buf = new TextEncoder().encode("buffer data").buffer;
      ctx.body = buf;
      const res = buildResponse(ctx);
      expect(await res.text()).toBe("buffer data");
    });
  });

  // ─── TypedArray (ArrayBuffer.isView) body ────────────────

  describe("TypedArray body", () => {
    test("returns Response with Uint8Array body", async () => {
      const ctx = createCtx();
      ctx.body = new TextEncoder().encode("typed array");
      const res = buildResponse(ctx);
      expect(await res.text()).toBe("typed array");
    });

    test("returns Response with Int8Array body", async () => {
      const ctx = createCtx();
      const arr = new Int8Array([72, 101, 108, 108, 111]);
      ctx.body = arr;
      const res = buildResponse(ctx);
      expect(await res.text()).toBe("Hello");
    });
  });

  // ─── Blob body ───────────────────────────────────────────

  describe("Blob body", () => {
    test("returns Response with Blob body", async () => {
      const ctx = createCtx();
      ctx.body = new Blob(["blob content"], { type: "text/plain" });
      const res = buildResponse(ctx);
      expect(await res.text()).toBe("blob content");
    });
  });

  // ─── Async iterable body ─────────────────────────────────

  describe("async iterable body", () => {
    test("returns Response with async iterable body", async () => {
      const ctx = createCtx();
      async function* gen() {
        yield new TextEncoder().encode("chunk1");
        yield new TextEncoder().encode("chunk2");
      }
      ctx.body = gen();
      const res = buildResponse(ctx);
      expect(await res.text()).toBe("chunk1chunk2");
    });
  });

  // ─── Object body (JSON fallback) ─────────────────────────

  describe("object body (JSON fallback)", () => {
    test("returns Response with JSON body for plain object", async () => {
      const ctx = createCtx();
      ctx.body = { key: "value", num: 42 };
      const res = buildResponse(ctx);
      const json = await res.json();
      expect(json).toEqual({ key: "value", num: 42 });
    });

    test("returns Response with JSON body for array", async () => {
      const ctx = createCtx();
      ctx.body = [1, 2, 3];
      const res = buildResponse(ctx);
      const json = await res.json();
      expect(json).toEqual([1, 2, 3]);
    });

    test("JSON body with status code", () => {
      const ctx = createCtx();
      ctx.body = { error: "not found" };
      ctx.statusCode = 404;
      const res = buildResponse(ctx);
      expect(res.status).toBe(404);
    });

    test("JSON body with headers", () => {
      const ctx = createCtx();
      ctx.body = { data: "test" };
      ctx.setHeader("X-Custom", "val");
      const res = buildResponse(ctx);
      expect(res.headers.get("X-Custom")).toBe("val");
    });
  });

  // ─── Headers passthrough ─────────────────────────────────

  describe("headers passthrough", () => {
    test("multiple headers are passed through", () => {
      const ctx = createCtx();
      ctx.body = "test";
      ctx.setHeader("X-First", "1");
      ctx.setHeader("X-Second", "2");
      const res = buildResponse(ctx);
      expect(res.headers.get("X-First")).toBe("1");
      expect(res.headers.get("X-Second")).toBe("2");
    });

    test("no headers allocated when none set", () => {
      const ctx = createCtx();
      ctx.body = "test";
      buildResponse(ctx);
      expect(ctx.hasHeaders()).toBe(false);
    });
  });

  // ─── Default status code ─────────────────────────────────

  describe("default status code", () => {
    test("uses 200 as default status", () => {
      const ctx = createCtx();
      ctx.body = "test";
      const res = buildResponse(ctx);
      expect(res.status).toBe(200);
    });
  });
});
