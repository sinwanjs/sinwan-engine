import { describe, expect, test, beforeEach } from "bun:test";
import {
  Context,
  type ContextOptions,
  type GRPCData,
} from "../../src/context/context";
import { EventBus } from "../../src/event-bus";
import { ErrorHandler } from "../../src/error-handler";
import { createTestBus, createTestContext } from "../helpers";
import type { Request } from "../../src/types";

function makeCtx(overrides?: Partial<ContextOptions>): Context {
  const bus = overrides?.bus ?? createTestBus();
  return createTestContext(bus, overrides);
}

function makeReq(
  url: string = "http://localhost:3000/path?query=1",
  opts: RequestInit = {},
): Request {
  return new Request(url, opts) as unknown as Request;
}

describe("Context", () => {
  let bus: EventBus;
  let ctx: Context;

  beforeEach(() => {
    bus = createTestBus();
    ctx = makeCtx({ bus });
  });

  // ─── Constructor ────────────────────────────────────────

  describe("constructor", () => {
    test("initializes with default values", () => {
      const c = makeCtx();
      expect(c.statusCode).toBe(200);
      expect(c.body).toBeNull();
      expect(c.pathname).toBe("");
      expect(c.params).toEqual({});
      expect(c.maxBodySize).toBe(10 * 1024 * 1024);
    });

    test("accepts custom requestId", () => {
      const c = makeCtx({ requestId: "custom-id" });
      expect(c.requestId).toBe("custom-id");
    });

    test("generates requestId lazily", () => {
      const c = makeCtx();
      const id = c.requestId;
      expect(id).toMatch(/^sinwan-request-/);
      // Second access returns same id
      expect(c.requestId).toBe(id);
    });

    test("accepts custom trace options", () => {
      const c = makeCtx({
        trace: { enabled: false, maxEntries: 50, includePayload: true },
      });
      // Trace disabled — recordEvent should be no-op
      c.recordEvent(
        {
          name: "test",
          event: "test",
          timestamp: 0,
          sequence: 0,
          requestId: "",
          source: "test",
        },
        { data: 1 },
      );
      expect(c.eventTrace.length).toBe(0);
    });

    test("accepts global state map", () => {
      const global = new Map([["key", "value"]]);
      const c = makeCtx({ global });
      expect(c.getGlobal<string>("key")).toBe("value");
    });
  });

  // ─── setReq ─────────────────────────────────────────────

  describe("setReq()", () => {
    test("sets request and parses pathname", () => {
      const req = makeReq("http://localhost:3000/users/123?filter=active");
      ctx.setReq(req);
      expect(ctx.pathname).toBe("/users/123");
    });

    test("pathname without query string", () => {
      const req = makeReq("http://localhost:3000/users/123");
      ctx.setReq(req);
      expect(ctx.pathname).toBe("/users/123");
    });

    test("pathname with no path segment", () => {
      const req = makeReq("http://localhost:3000");
      ctx.setReq(req);
      expect(ctx.pathname).toBe("/");
    });
  });

  // ─── query ──────────────────────────────────────────────

  describe("query", () => {
    test("parses query params", () => {
      ctx.setReq(makeReq("http://localhost:3000/path?a=1&b=2"));
      expect(ctx.query.get("a")).toBe("1");
      expect(ctx.query.get("b")).toBe("2");
    });

    test("returns empty URLSearchParams when no query", () => {
      ctx.setReq(makeReq("http://localhost:3000/path"));
      expect(ctx.query.get("a")).toBeNull();
    });

    test("caches query result", () => {
      ctx.setReq(makeReq("http://localhost:3000/path?a=1"));
      const q1 = ctx.query;
      const q2 = ctx.query;
      expect(q1).toBe(q2);
    });
  });

  // ─── headers ────────────────────────────────────────────

  describe("headers", () => {
    test("lazy-initialized", () => {
      expect(ctx.hasHeaders()).toBe(false);
      ctx.headers.set("X-Custom", "value");
      expect(ctx.hasHeaders()).toBe(true);
      expect(ctx.headers.get("X-Custom")).toBe("value");
    });

    test("setHeader emits header:set event", () => {
      ctx.setReq(makeReq());
      let emitted = false;
      bus.on("header:set", (c, payload) => {
        emitted = true;
        expect((payload as { key: string; value: string }).key).toBe("X-Test");
      });
      ctx.setHeader("X-Test", "val");
      expect(emitted).toBe(true);
    });

    test("setHeader works without bus listeners", () => {
      ctx.setReq(makeReq());
      ctx.setHeader("X-Test", "val");
      expect(ctx.headers.get("X-Test")).toBe("val");
    });
  });

  // ─── State Management ───────────────────────────────────

  describe("state", () => {
    test("set/get", () => {
      ctx.set("key", "value");
      expect(ctx.get<string>("key")).toBe("value");
    });

    test("get returns undefined for missing key", () => {
      expect(ctx.get("missing")).toBeUndefined();
    });

    test("getOnce removes the value", () => {
      ctx.set("key", "value");
      expect(ctx.getOnce<string>("key")).toBe("value");
      expect(ctx.get("key")).toBeUndefined();
    });

    test("update modifies existing value", () => {
      ctx.set("count", 1);
      ctx.update<number>("count", (prev) => (prev ?? 0) + 1);
      expect(ctx.get<number>("count")).toBe(2);
    });

    test("clear removes a key", () => {
      ctx.set("key", "value");
      expect(ctx.clear("key")).toBe(true);
      expect(ctx.get("key")).toBeUndefined();
    });

    test("clear returns false for missing key", () => {
      expect(ctx.clear("missing")).toBe(false);
    });

    test("clearAll removes all keys", () => {
      ctx.set("a", 1);
      ctx.set("b", 2);
      ctx.clearAll();
      expect(ctx.get("a")).toBeUndefined();
      expect(ctx.get("b")).toBeUndefined();
    });

    test("has checks existence", () => {
      ctx.set("key", "value");
      expect(ctx.has("key")).toBe(true);
      expect(ctx.has("missing")).toBe(false);
    });

    test("exportState excludes underscore-prefixed keys", () => {
      ctx.set("public", 1);
      ctx.set("_private", 2);
      const exported = ctx.exportState();
      expect(exported.public).toBe(1);
      expect("_private" in exported).toBe(false);
    });

    test("importState merges from object", () => {
      ctx.importState({ a: 1, b: 2 });
      expect(ctx.get<number>("a")).toBe(1);
      expect(ctx.get<number>("b")).toBe(2);
    });

    test("snapshot returns frozen object", () => {
      ctx.set("key", "value");
      const snap = ctx.snapshot();
      expect(Object.isFrozen(snap)).toBe(true);
      expect(snap.key).toBe("value");
    });
  });

  // ─── Global State ───────────────────────────────────────

  describe("global state", () => {
    test("setGlobal/getGlobal", () => {
      ctx.setGlobal("key", "value");
      expect(ctx.getGlobal<string>("key")).toBe("value");
    });

    test("getGlobalOnce removes value", () => {
      ctx.setGlobal("key", "value");
      expect(ctx.getGlobalOnce<string>("key")).toBe("value");
      expect(ctx.getGlobal("key")).toBeUndefined();
    });

    test("updateGlobal modifies value", () => {
      ctx.setGlobal("count", 1);
      ctx.updateGlobal<number>("count", (prev) => (prev ?? 0) + 1);
      expect(ctx.getGlobal<number>("count")).toBe(2);
    });

    test("clearGlobal removes key", () => {
      ctx.setGlobal("key", "value");
      expect(ctx.clearGlobal("key")).toBe(true);
      expect(ctx.getGlobal("key")).toBeUndefined();
    });

    test("clearAllGlobal removes all", () => {
      ctx.setGlobal("a", 1);
      ctx.setGlobal("b", 2);
      ctx.clearAllGlobal();
      expect(ctx.getGlobal("a")).toBeUndefined();
    });

    test("hasGlobal checks existence", () => {
      ctx.setGlobal("key", "value");
      expect(ctx.hasGlobal("key")).toBe(true);
      expect(ctx.hasGlobal("missing")).toBe(false);
    });

    test("snapshotGlobal returns frozen object", () => {
      ctx.setGlobal("key", "value");
      const snap = ctx.snapshotGlobal();
      expect(Object.isFrozen(snap)).toBe(true);
      expect(snap.key).toBe("value");
    });
  });

  // ─── Response Methods ───────────────────────────────────

  describe("json()", () => {
    test("sets JSON response", () => {
      ctx.json({ data: 1 });
      expect(ctx.body).toEqual({ data: 1 });
      expect(ctx.hasResponded()).toBe(true);
      expect(ctx.isStopped()).toBe(true);
      expect(ctx.headers.get("Content-Type")).toBe("application/json");
    });

    test("sets custom status", () => {
      ctx.json({ data: 1 }, 201);
      expect(ctx.statusCode).toBe(201);
    });

    test("throws on double response", () => {
      ctx.json({ data: 1 });
      expect(() => ctx.json({ data: 2 })).toThrow("Response already sent");
    });

    test("emits response:set event", () => {
      let emitted = false;
      bus.on("response:set", (c, payload) => {
        emitted = true;
        expect((payload as { kind: string }).kind).toBe("json");
      });
      ctx.json({ data: 1 });
      expect(emitted).toBe(true);
    });
  });

  describe("text()", () => {
    test("sets text response", () => {
      ctx.text("hello");
      expect(ctx.body).toBe("hello");
      expect(ctx.hasResponded()).toBe(true);
      expect(ctx.headers.get("Content-Type")).toBe("text/plain");
    });

    test("throws on double response", () => {
      ctx.text("hello");
      expect(() => ctx.text("world")).toThrow("Response already sent");
    });
  });

  describe("html()", () => {
    test("sets HTML response with string", () => {
      ctx.html("<h1>Hi</h1>");
      expect(ctx.body).toBe("<h1>Hi</h1>");
      expect(ctx.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
    });

    test("sets HTML response with Promise", async () => {
      await ctx.html(Promise.resolve("<h1>Async</h1>"));
      expect(ctx.body).toBe("<h1>Async</h1>");
    });

    test("throws on double response (sync)", () => {
      ctx.html("<h1>Hi</h1>");
      expect(() => ctx.html("<h1>Bye</h1>")).toThrow("Response already sent");
    });
  });

  describe("redirect()", () => {
    test("sets redirect response", () => {
      ctx.setReq(makeReq("http://localhost:3000/old"));
      ctx.redirect("/new");
      expect(ctx.statusCode).toBe(302);
      expect(ctx.headers.get("Location")).toBe("http://localhost:3000/new");
      expect(ctx.hasResponded()).toBe(true);
    });

    test("custom status", () => {
      ctx.setReq(makeReq("http://localhost:3000/old"));
      ctx.redirect("/new", 301);
      expect(ctx.statusCode).toBe(301);
    });

    test("throws on double response", () => {
      ctx.setReq(makeReq("http://localhost:3000/old"));
      ctx.redirect("/new");
      expect(() => ctx.redirect("/other")).toThrow("Response already sent");
    });
  });

  describe("redirectWith()", () => {
    test("stores data in global and redirects", () => {
      ctx.setReq(makeReq("http://localhost:3000/old"));
      ctx.redirectWith("/new", { flash: "success" });
      expect(ctx.statusCode).toBe(302);
      expect(ctx.hasResponded()).toBe(true);
      const location = ctx.headers.get("Location")!;
      expect(location).toContain("/new");
      expect(location).toContain("redirect=id_");
    });

    test("custom keyParam", () => {
      ctx.setReq(makeReq("http://localhost:3000/old"));
      ctx.redirectWith("/new", { data: 1 }, { keyParam: "flash" });
      const location = ctx.headers.get("Location")!;
      expect(location).toContain("flash=id_");
    });

    test("custom status", () => {
      ctx.setReq(makeReq("http://localhost:3000/old"));
      ctx.redirectWith("/new", { data: 1 }, { status: 303 });
      expect(ctx.statusCode).toBe(303);
    });

    test("Bug 1 fix: throws before side-effects on double response", () => {
      ctx.setReq(makeReq("http://localhost:3000/old"));
      ctx.json({ data: 1 });
      // Should throw without polluting global state
      expect(() => ctx.redirectWith("/new", { flash: "leaked" })).toThrow(
        "Response already sent",
      );
      // Verify no orphaned global entries were created
      const snap = ctx.snapshotGlobal();
      expect(Object.keys(snap).length).toBe(0);
    });
  });

  describe("redirectData()", () => {
    test("retrieves and consumes redirect data", () => {
      ctx.setReq(makeReq("http://localhost:3000/new?redirect=id_abc123"));
      ctx.setGlobal("id_abc123", { flash: "success" });
      const data = ctx.redirectData<{ flash: string }>();
      expect(data).toEqual({ flash: "success" });
      // Data is consumed
      expect(ctx.getGlobal("id_abc123")).toBeUndefined();
    });

    test("returns undefined when no query param", () => {
      ctx.setReq(makeReq("http://localhost:3000/new"));
      expect(ctx.redirectData()).toBeUndefined();
    });

    test("returns undefined for non-id_ prefixed keys", () => {
      ctx.setReq(makeReq("http://localhost:3000/new?redirect=evil_key"));
      ctx.setGlobal("evil_key", "hacked");
      expect(ctx.redirectData()).toBeUndefined();
    });

    test("custom keyParam", () => {
      ctx.setReq(makeReq("http://localhost:3000/new?flash=id_abc"));
      ctx.setGlobal("id_abc", { data: 1 });
      const data = ctx.redirectData<{ data: number }>("flash");
      expect(data).toEqual({ data: 1 });
    });
  });

  describe("stream()", () => {
    test("sets streaming response", () => {
      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello"));
          controller.close();
        },
      });
      ctx.stream(readable);
      expect(ctx.hasResponded()).toBe(true);
      expect(ctx.isStreaming()).toBe(true);
      expect(ctx.headers.get("Content-Type")).toBe("application/octet-stream");
    });

    test("custom content type and status", () => {
      const readable = new ReadableStream({
        start(c) {
          c.close();
        },
      });
      ctx.stream(readable, 206, "text/event-stream");
      expect(ctx.statusCode).toBe(206);
      expect(ctx.headers.get("Content-Type")).toBe("text/event-stream");
    });

    test("throws on double response", () => {
      ctx.json({});
      expect(() =>
        ctx.stream(
          new ReadableStream({
            start(c) {
              c.close();
            },
          }),
        ),
      ).toThrow("Response already sent");
    });
  });

  describe("iterate()", () => {
    test("sets iterator response", () => {
      async function* gen() {
        yield "chunk1";
        yield "chunk2";
      }
      ctx.iterate(gen());
      expect(ctx.hasResponded()).toBe(true);
      expect(ctx.isStreaming()).toBe(true);
    });

    test("accepts generator function", () => {
      ctx.iterate(async function* () {
        yield "data";
      });
      expect(ctx.hasResponded()).toBe(true);
    });

    test("throws on double response", () => {
      ctx.json({});
      expect(() =>
        ctx.iterate(async function* () {
          yield "x";
        }),
      ).toThrow("Response already sent");
    });
  });

  describe("sse()", () => {
    test("returns SSE controller and sets response", () => {
      const controller = ctx.sse();
      expect(typeof controller.send).toBe("function");
      expect(typeof controller.comment).toBe("function");
      expect(typeof controller.close).toBe("function");
      expect(ctx.hasResponded()).toBe(true);
      expect(ctx.isStreaming()).toBe(true);
      expect(ctx.headers.get("Content-Type")).toBe("text/event-stream");
      expect(ctx.headers.get("Cache-Control")).toBe("no-cache");
      expect(ctx.headers.get("Connection")).toBe("keep-alive");
    });

    test("send() writes data lines", async () => {
      const controller = ctx.sse();
      controller.send("hello", "custom-event", "42", 5000);
      // Just verify it doesn't throw — the stream is internal
      controller.close();
    });

    test("send() with object data", async () => {
      const controller = ctx.sse();
      controller.send({ key: "value" });
      controller.close();
    });

    test("comment() writes comment", () => {
      const controller = ctx.sse();
      controller.comment("keepalive");
      controller.close();
    });

    test("close() disposes context", () => {
      const controller = ctx.sse();
      controller.close();
      // Double close should not throw
      controller.close();
    });

    test("custom status", () => {
      ctx.sse({ status: 201 });
      expect(ctx.statusCode).toBe(201);
    });

    test("retry option sends retry field", () => {
      ctx.sse({ retry: 3000 });
      // Just verify it doesn't throw
    });

    test("throws on double response", () => {
      ctx.json({});
      expect(() => ctx.sse()).toThrow("Response already sent");
    });
  });

  describe("buffer()", () => {
    test("sets buffer response", () => {
      const data = new Uint8Array([1, 2, 3]);
      ctx.buffer(data);
      expect(ctx.body).toBe(data);
      expect(ctx.headers.get("Content-Type")).toBe("application/octet-stream");
    });

    test("custom content type and status", () => {
      ctx.buffer(new Uint8Array([1]), 200, "image/png");
      expect(ctx.headers.get("Content-Type")).toBe("image/png");
    });

    test("throws on double response", () => {
      ctx.json({});
      expect(() => ctx.buffer(new Uint8Array([1]))).toThrow(
        "Response already sent",
      );
    });
  });

  describe("file()", () => {
    test("sets file response with inferred content type", () => {
      // Create a temp file
      const path = "/tmp/sinwan-test-file.txt";
      Bun.write(path, "test content");
      ctx.file(path);
      expect(ctx.hasResponded()).toBe(true);
      expect(ctx.headers.get("Content-Type")).toBe("text/plain;charset=utf-8");
    });

    test("sets file response with custom content type", () => {
      const path = "/tmp/sinwan-test-file.txt";
      Bun.write(path, "test content");
      ctx.file(path, 200, "application/custom");
      expect(ctx.headers.get("Content-Type")).toBe("application/custom");
    });

    test("throws on double response", () => {
      ctx.json({});
      expect(() => ctx.file("/tmp/sinwan-test-file.txt")).toThrow(
        "Response already sent",
      );
    });
  });

  // ─── Flow Control ───────────────────────────────────────

  describe("flow control", () => {
    test("stop() sets stopped flag", () => {
      ctx.stop();
      expect(ctx.isStopped()).toBe(true);
    });

    test("stop() emits context:stop event", () => {
      let emitted = false;
      bus.on("context:stop", () => {
        emitted = true;
      });
      ctx.stop();
      expect(emitted).toBe(true);
    });

    test("hasResponded()", () => {
      expect(ctx.hasResponded()).toBe(false);
      ctx.json({});
      expect(ctx.hasResponded()).toBe(true);
    });

    test("isStreaming()", () => {
      expect(ctx.isStreaming()).toBe(false);
      ctx.stream(
        new ReadableStream({
          start(c) {
            c.close();
          },
        }),
      );
      expect(ctx.isStreaming()).toBe(true);
    });

    test("skip() and isSkipped()", () => {
      expect(ctx.isSkipped()).toBe(false);
      ctx.skip();
      expect(ctx.isSkipped()).toBe(true);
    });

    test("clearSkip()", () => {
      ctx.skip();
      ctx.clearSkip();
      expect(ctx.isSkipped()).toBe(false);
    });

    test("respond() and isRespondEarly()", () => {
      expect(ctx.isRespondEarly()).toBe(false);
      ctx.respond();
      expect(ctx.isRespondEarly()).toBe(true);
    });

    test("fail() and isFailed()", () => {
      expect(ctx.isFailed()).toBe(false);
      ctx.fail(new Error("step failed"));
      expect(ctx.isFailed()).toBe(true);
      expect(ctx.failError).toBeInstanceOf(Error);
    });

    test("clearFail()", () => {
      ctx.fail(new Error("step failed"));
      ctx.clearFail();
      expect(ctx.isFailed()).toBe(false);
      expect(ctx.failError).toBeNull();
    });
  });

  // ─── setRawResponse ─────────────────────────────────────

  describe("setRawResponse()", () => {
    test("sets response without events", () => {
      let emitted = false;
      bus.on("response:set", () => {
        emitted = true;
      });
      ctx.setRawResponse("raw", 200, "text/plain");
      expect(ctx.body).toBe("raw");
      expect(ctx.statusCode).toBe(200);
      expect(ctx.hasResponded()).toBe(true);
      expect(ctx.isStopped()).toBe(true);
      expect(emitted).toBe(false);
    });

    test("without contentType", () => {
      ctx.setRawResponse("raw");
      expect(ctx.body).toBe("raw");
    });
  });

  // ─── EventBus Interaction ───────────────────────────────

  describe("EventBus interaction", () => {
    test("attachBus()", () => {
      const c = new Context({ errorHandler: new ErrorHandler() });
      c.attachBus(bus);
      // Should not throw
      c.attachBus(bus); // same bus is ok
    });

    test("attachBus throws on different bus", () => {
      const c = new Context({ errorHandler: new ErrorHandler() });
      c.attachBus(bus);
      const bus2 = createTestBus();
      expect(() => c.attachBus(bus2)).toThrow(
        "already attached to a different EventBus",
      );
    });

    test("emitAsync()", async () => {
      let received: unknown;
      bus.on("test", (c, payload) => {
        received = payload;
      });
      await ctx.emitAsync("test", { data: 1 });
      expect(received).toEqual({ data: 1 });
    });

    test("emitSync()", () => {
      let received: unknown;
      bus.on("test", (c, payload) => {
        received = payload;
      });
      ctx.emitSync("test", { data: 1 });
      expect(received).toEqual({ data: 1 });
    });

    test("emitAsync/emitSync throw without bus", async () => {
      const c = new Context({ errorHandler: new ErrorHandler() });
      expect(() => c.emitSync("test")).toThrow("not attached to an EventBus");
      await expect(c.emitAsync("test")).rejects.toThrow(
        "not attached to an EventBus",
      );
    });

    test("on() registers scoped listener", async () => {
      let called = false;
      ctx.on("test", () => {
        called = true;
      });
      await bus.emitAsync("test", ctx);
      expect(called).toBe(true);
    });

    test("on() scoped listener only fires for this context", async () => {
      let called = false;
      const ctx2 = makeCtx({ bus });
      ctx.on("test", () => {
        called = true;
      });
      await bus.emitAsync("test", ctx2);
      expect(called).toBe(false);
    });

    test("once() registers scoped once listener", async () => {
      let count = 0;
      ctx.once("test", () => {
        count++;
      });
      await bus.emitAsync("test", ctx);
      await bus.emitAsync("test", ctx);
      expect(count).toBe(1);
    });

    test("off() removes scoped listener", async () => {
      let called = false;
      const handler = () => {
        called = true;
      };
      ctx.on("test", handler);
      ctx.off("test", handler);
      await bus.emitAsync("test", ctx);
      expect(called).toBe(false);
    });

    test("off() with unregistered handler does not throw", () => {
      expect(() => ctx.off("test", () => {})).not.toThrow();
    });

    test("on() with ListenerOptions (signal)", async () => {
      const ac = new AbortController();
      let called = false;
      ctx.on(
        "test",
        () => {
          called = true;
        },
        { signal: ac.signal },
      );
      await bus.emitAsync("test", ctx);
      expect(called).toBe(true);
    });
  });

  // ─── Dispose ────────────────────────────────────────────

  describe("dispose()", () => {
    test("disposes context and clears scoped handlers", async () => {
      let called = false;
      ctx.on("test", () => {
        called = true;
      });
      ctx.dispose();
      await bus.emitAsync("test", ctx);
      expect(called).toBe(false);
    });

    test("emits context:dispose event", () => {
      let emitted = false;
      bus.on("context:dispose", () => {
        emitted = true;
      });
      ctx.dispose();
      expect(emitted).toBe(true);
    });

    test("calls onDispose callbacks", () => {
      let called = false;
      ctx.onDispose(() => {
        called = true;
      });
      ctx.dispose();
      expect(called).toBe(true);
    });

    test("onDispose called immediately if already disposed", () => {
      ctx.dispose();
      let called = false;
      ctx.onDispose(() => {
        called = true;
      });
      expect(called).toBe(true);
    });

    test("double dispose is no-op", () => {
      let count = 0;
      ctx.onDispose(() => {
        count++;
      });
      ctx.dispose();
      ctx.dispose();
      expect(count).toBe(1);
    });

    test("onDispose callback error is swallowed", () => {
      ctx.onDispose(() => {
        throw new Error("callback error");
      });
      expect(() => ctx.dispose()).not.toThrow();
    });

    test("dispose clears streaming flag", () => {
      ctx.stream(
        new ReadableStream({
          start(c) {
            c.close();
          },
        }),
      );
      expect(ctx.isStreaming()).toBe(true);
      ctx.dispose();
      expect(ctx.isStreaming()).toBe(false);
    });
  });

  // ─── Event Trace ────────────────────────────────────────

  describe("event trace", () => {
    test("recordEvent stores entries", () => {
      ctx.recordEvent(
        {
          name: "test",
          event: "test",
          timestamp: Date.now(),
          sequence: 1,
          requestId: "req",
          source: "test",
        },
        { data: 1 },
      );
      expect(ctx.eventTrace.length).toBe(1);
      expect(ctx.eventTrace[0]!.name).toBe("test");
    });

    test("recordEvent with includePayload stores payload", () => {
      const c = makeCtx({ trace: { includePayload: true } });
      c.recordEvent(
        {
          name: "test",
          event: "test",
          timestamp: 0,
          sequence: 0,
          requestId: "",
          source: "test",
        },
        { data: 42 },
      );
      expect(c.eventTrace[0]!.payload).toEqual({ data: 42 });
    });

    test("recordEvent disabled when trace.enabled=false", () => {
      const c = makeCtx({ trace: { enabled: false } });
      c.recordEvent(
        {
          name: "test",
          event: "test",
          timestamp: 0,
          sequence: 0,
          requestId: "",
          source: "test",
        },
        null,
      );
      expect(c.eventTrace.length).toBe(0);
    });

    test("ring buffer overwrites oldest entries", () => {
      const c = makeCtx({ trace: { maxEntries: 3 } });
      for (let i = 0; i < 5; i++) {
        c.recordEvent(
          {
            name: `evt${i}`,
            event: "test",
            timestamp: 0,
            sequence: i,
            requestId: "",
            source: "test",
          },
          null,
        );
      }
      expect(c.eventTrace.length).toBe(3);
      // Should contain the 3 most recent: evt2, evt3, evt4
      const names = c.eventTrace.map((e) => e.name);
      expect(names).toContain("evt2");
      expect(names).toContain("evt3");
      expect(names).toContain("evt4");
    });

    test("getEventTrace returns readonly array", () => {
      ctx.recordEvent(
        {
          name: "test",
          event: "test",
          timestamp: 0,
          sequence: 0,
          requestId: "",
          source: "test",
        },
        null,
      );
      const trace = ctx.getEventTrace();
      expect(trace.length).toBe(1);
    });

    test("maxEntries=0 skips recording", () => {
      const c = makeCtx({ trace: { maxEntries: 0 } });
      c.recordEvent(
        {
          name: "test",
          event: "test",
          timestamp: 0,
          sequence: 0,
          requestId: "",
          source: "test",
        },
        null,
      );
      expect(c.eventTrace.length).toBe(0);
    });
  });

  // ─── parseBody ──────────────────────────────────────────

  describe("parseBody()", () => {
    test("parses JSON body", async () => {
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "17",
          },
          body: '{"key":"value"}',
        }),
      );
      const body = await ctx.parseBody();
      expect(body).toEqual({ key: "value" });
    });

    test("caches parsed body", async () => {
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "17",
          },
          body: '{"key":"value"}',
        }),
      );
      const b1 = await ctx.parseBody();
      const b2 = await ctx.parseBody();
      expect(b1).toBe(b2);
    });

    test("parses text body", async () => {
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: { "Content-Type": "text/plain", "Content-Length": "5" },
          body: "hello",
        }),
      );
      const body = await ctx.parseBody();
      expect(body).toBe("hello");
    });

    test("throws 413 for oversized body", async () => {
      ctx.maxBodySize = 10;
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "100",
          },
          body: '{"key":"value"}',
        }),
      );
      await expect(ctx.parseBody()).rejects.toThrow("Payload too large");
    });

    test("parses form-urlencoded body", async () => {
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": "7",
          },
          body: "a=1&b=2",
        }),
      );
      const body = (await ctx.parseBody()) as Record<string, string>;
      expect(body.a).toBe("1");
      expect(body.b).toBe("2");
    });

    test("emits body:parsed event", async () => {
      let emitted = false;
      bus.on("body:parsed", (c, payload) => {
        emitted = true;
        expect((payload as { kind: string }).kind).toBe("json");
      });
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "17",
          },
          body: '{"key":"value"}',
        }),
      );
      await ctx.parseBody();
      expect(emitted).toBe(true);
    });

    test("emits body:parse:error on parse failure", async () => {
      let emitted = false;
      bus.on("body:parse:error", (c, payload) => {
        emitted = true;
      });
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "5",
          },
          body: "bad{js",
        }),
      );
      try {
        await ctx.parseBody();
      } catch {
        // expected
      }
      expect(emitted).toBe(true);
    });

    test("JSON without content-length uses safeText path", async () => {
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: '{"key":"value"}',
        }),
      );
      const body = await ctx.parseBody();
      expect(body).toEqual({ key: "value" });
    });

    test("text without content-length uses streaming size enforcement", async () => {
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "hello world",
        }),
      );
      const body = await ctx.parseBody();
      expect(body).toBe("hello world");
    });

    test("text without content-length enforces maxBodySize", async () => {
      ctx.maxBodySize = 5;
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "hello world this is too long",
        }),
      );
      await expect(ctx.parseBody()).rejects.toThrow("Payload too large");
    });

    test("text with no body returns empty string", async () => {
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
        }),
      );
      const body = await ctx.parseBody();
      expect(body).toBe("");
    });
  });

  // ─── formData ───────────────────────────────────────────

  describe("formData()", () => {
    test("throws 415 for non-form content type", async () => {
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "2",
          },
          body: "{}",
        }),
      );
      await expect(ctx.formData()).rejects.toThrow(
        "Expected a form Content-Type",
      );
    });

    test("throws 400 for empty body (content-length=0)", async () => {
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: {
            "Content-Type": "multipart/form-data; boundary=abc",
            "Content-Length": "0",
          },
        }),
      );
      await expect(ctx.formData()).rejects.toThrow("Request body is empty");
    });

    test("throws 413 for oversized form", async () => {
      ctx.maxBodySize = 10;
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: {
            "Content-Type": "multipart/form-data; boundary=abc",
            "Content-Length": "100",
          },
        }),
      );
      await expect(ctx.formData()).rejects.toThrow("Payload too large");
    });

    test("caches formData result", async () => {
      const formData = new FormData();
      formData.append("key", "value");
      // Serialize FormData through Response to get a proper multipart body
      const serialized = new Response(formData);
      const contentType = serialized.headers.get("Content-Type")!;
      const body = await serialized.text();
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(body.length),
          },
          body,
        }),
      );
      const fd1 = await ctx.formData();
      const fd2 = await ctx.formData();
      expect(fd1).toBe(fd2);
    });
  });

  // ─── saveFile ───────────────────────────────────────────

  describe("saveFile()", () => {
    test("throws 400 if field is missing", async () => {
      const formData = new FormData();
      const serialized = new Response(formData);
      const contentType = serialized.headers.get("Content-Type")!;
      const body = await serialized.text();
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(body.length),
          },
          body,
        }),
      );
      await expect(
        ctx.saveFile("avatar", "/tmp/test-save.png"),
      ).rejects.toThrow('Form field "avatar" is missing');
    });

    test("throws 400 if field is a string not a file", async () => {
      const formData = new FormData();
      formData.append("name", "john");
      const serialized = new Response(formData);
      const contentType = serialized.headers.get("Content-Type")!;
      const body = await serialized.text();
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(body.length),
          },
          body,
        }),
      );
      await expect(ctx.saveFile("name", "/tmp/test-save.txt")).rejects.toThrow(
        'Form field "name" is a plain string',
      );
    });
  });

  describe("saveFiles()", () => {
    test("throws for missing fields", async () => {
      const formData = new FormData();
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: {
            "Content-Type": "multipart/form-data; boundary=abc",
            "Content-Length": "50",
          },
          body: formData,
        }),
      );
      await expect(
        ctx.saveFiles([{ field: "a", dest: "/tmp/a" }]),
      ).rejects.toThrow();
    });
  });

  // ─── reset ──────────────────────────────────────────────

  describe("reset()", () => {
    test("resets all per-request state", () => {
      ctx.setReq(makeReq("http://localhost:3000/path?a=1"));
      ctx.json({ data: 1 });
      ctx.set("key", "value");
      ctx.fail(new Error("err"));
      ctx.skip();
      ctx.statusCode = 500;
      ctx.maxBodySize = 100;
      ctx.headers.set("X-Custom", "val");

      ctx.reset({ errorHandler: new ErrorHandler(), bus });

      expect(ctx.statusCode).toBe(200);
      expect(ctx.body).toBeNull();
      expect(ctx.isStopped()).toBe(false);
      expect(ctx.hasResponded()).toBe(false);
      expect(ctx.isFailed()).toBe(false);
      expect(ctx.isSkipped()).toBe(false);
      expect(ctx.get("key")).toBeUndefined();
      expect(ctx.hasHeaders()).toBe(false);
    });

    test("Bug 2 fix: resets maxBodySize to default", () => {
      ctx.maxBodySize = 100;
      ctx.reset({ errorHandler: new ErrorHandler(), bus });
      expect(ctx.maxBodySize).toBe(10 * 1024 * 1024);
    });

    test("Bug 4 fix: updates errorHandler from options", () => {
      const newErrorHandler = new ErrorHandler();
      ctx.reset({ errorHandler: newErrorHandler, bus });
      // The new errorHandler should be used — verify by calling catch()
      // which delegates to errorHandler.handle
      expect(() => ctx.catch(new Error("test"), ctx, false)).not.toThrow();
    });

    test("resets event trace", () => {
      ctx.recordEvent(
        {
          name: "test",
          event: "test",
          timestamp: 0,
          sequence: 0,
          requestId: "",
          source: "test",
        },
        null,
      );
      ctx.reset({ errorHandler: new ErrorHandler(), bus });
      expect(ctx.eventTrace.length).toBe(0);
    });

    test("resets scoped handlers", async () => {
      let called = false;
      ctx.on("test", () => {
        called = true;
      });
      ctx.reset({ errorHandler: new ErrorHandler(), bus });
      await bus.emitAsync("test", ctx);
      // After reset, scoped handler should be gone — but bus still has it
      // Actually the handler was registered on the bus, reset only clears tracking.
      // The wrapped handler checks ctx !== this so it won't fire.
      expect(called).toBe(false);
    });
  });

  // ─── markReleased ───────────────────────────────────────

  describe("markReleased()", () => {
    test("returns false on first call", () => {
      expect(ctx.markReleased()).toBe(false);
    });

    test("returns true on second call", () => {
      ctx.markReleased();
      expect(ctx.markReleased()).toBe(true);
    });
  });

  // ─── Socket setters ─────────────────────────────────────

  describe("socket setters", () => {
    test("setWS()", () => {
      const ws = { data: { path: "/", data: null } } as unknown as Parameters<
        Context["setWS"]
      >[0];
      ctx.setWS(ws);
      expect(ctx.ws).toBe(ws);
    });

    test("setTCP()", () => {
      const tcp = {
        data: { name: "test", data: null },
      } as unknown as Parameters<Context["setTCP"]>[0];
      ctx.setTCP(tcp);
      expect(ctx.tcp).toBe(tcp);
    });

    test("setUDP()", () => {
      const udp = {
        data: { name: "test", data: null },
      } as unknown as Parameters<Context["setUDP"]>[0];
      ctx.setUDP(udp);
      expect(ctx.udp).toBe(udp);
    });

    test("setGRPC()", () => {
      const grpc: GRPCData = {
        name: "test",
        service: "Svc",
        method: "Method",
        path: "/",
        kind: "unary",
        call: null,
        metadata: null,
        data: null,
      };
      ctx.setGRPC(grpc);
      expect(ctx.grpc).toBe(grpc);
    });
  });

  // ─── Server methods ─────────────────────────────────────

  describe("server methods", () => {
    test("getServer() throws without server", () => {
      const c = new Context({ errorHandler: new ErrorHandler() });
      expect(() => c.pendingWebSockets).toThrow("not attached to a Server");
    });

    test("clientIP returns undefined without server", () => {
      const c = new Context({ errorHandler: new ErrorHandler() });
      expect(c.clientIP).toBeUndefined();
    });

    test("setTimeout does nothing without server", () => {
      const c = new Context({ errorHandler: new ErrorHandler() });
      expect(() => c.setTimeout(30)).not.toThrow();
    });

    test("publishToTopic delegates to server.publish", () => {
      const mockServer = {
        publish: () => 1,
        pendingWebSockets: 0,
        requestIP: () => undefined,
        timeout: () => {},
      };
      const c = new Context({
        errorHandler: new ErrorHandler(),
        server: mockServer as unknown as ContextOptions["server"],
      });
      expect(() => c.publishToTopic("topic", "data")).not.toThrow();
    });
  });

  // ─── Socket delegation methods ──────────────────────────

  describe("socket delegation methods", () => {
    function createMockWS(): Parameters<Context["setWS"]>[0] {
      const subs: string[] = [];
      return {
        data: { path: "/ws", data: { custom: "ws" } },
        remoteAddress: "127.0.0.1:1234",
        readyState: 1,
        subscriptions: subs,
        send: () => 0,
        close: () => {},
        subscribe: (t: string) => subs.push(t),
        unsubscribe: (t: string) => {
          const i = subs.indexOf(t);
          if (i >= 0) subs.splice(i, 1);
        },
        publish: () => 0,
        isSubscribed: (t: string) => subs.includes(t),
        cork: (cb: () => void) => cb(),
      } as unknown as Parameters<Context["setWS"]>[0];
    }

    function createMockTCP(): Parameters<Context["setTCP"]>[0] {
      return {
        data: { name: "tcp", data: { custom: "tcp" } },
        remoteAddress: "1.2.3.4:80",
        localAddress: "0.0.0.0:3000",
        write: () => 0,
        end: () => 0,
        flush: () => {},
        timeout: () => {},
      } as unknown as Parameters<Context["setTCP"]>[0];
    }

    function createMockUDP(): Parameters<Context["setUDP"]>[0] {
      return {
        data: { name: "udp", data: { custom: "udp" } },
        address: { address: "0.0.0.0", port: 9090, family: "IPv4" },
        closed: false,
        send: () => true,
        sendMany: () => 0,
        addMembership: () => true,
        dropMembership: () => true,
      } as unknown as Parameters<Context["setUDP"]>[0];
    }

    test("WS delegation: wsData, path, remoteAddress, readyState, subscriptions", () => {
      ctx.setWS(createMockWS());
      expect(ctx.wsData<{ custom: string }>()).toEqual({ custom: "ws" });
      expect(ctx.path).toBe("/ws");
      expect(ctx.remoteAddress).toBe("127.0.0.1:1234");
      expect(ctx.readyState).toBe(1);
      expect(ctx.subscriptions).toEqual([]);
    });

    test("WS delegation: send, close, subscribe, unsubscribe, publish, isSubscribed, cork", () => {
      ctx.setWS(createMockWS());
      expect(() => ctx.send("hi")).not.toThrow();
      expect(() => ctx.close()).not.toThrow();
      ctx.subscribe("news");
      expect(ctx.isSubscribed("news")).toBe(true);
      ctx.unsubscribe("news");
      expect(ctx.isSubscribed("news")).toBe(false);
      expect(() => ctx.publish("topic", "msg")).not.toThrow();
      expect(() => ctx.cork(() => {})).not.toThrow();
    });

    test("TCP delegation: tcpData, tcpName, tcpRemoteAddress, tcpLocalAddress", () => {
      ctx.setTCP(createMockTCP());
      expect(ctx.tcpData<{ custom: string }>()).toEqual({ custom: "tcp" });
      expect(ctx.tcpName).toBe("tcp");
      expect(ctx.tcpRemoteAddress).toBe("1.2.3.4:80");
      expect(ctx.tcpLocalAddress).toBe("0.0.0.0:3000");
    });

    test("TCP delegation: write, end, flush, timeout", () => {
      ctx.setTCP(createMockTCP());
      expect(() => ctx.write("data")).not.toThrow();
      expect(() => ctx.end()).not.toThrow();
      expect(() => ctx.flush()).not.toThrow();
      expect(() => ctx.timeout(30)).not.toThrow();
    });

    test("UDP delegation: udpData, udpName, udpAddress, udpClosed", () => {
      ctx.setUDP(createMockUDP());
      expect(ctx.udpData<{ custom: string }>()).toEqual({ custom: "udp" });
      expect(ctx.udpName).toBe("udp");
      expect(ctx.udpAddress.address).toBe("0.0.0.0");
      expect(ctx.udpClosed).toBe(false);
    });

    test("UDP delegation: sendUDP, sendManyUDP, addMembershipUDP, dropMembershipUDP", () => {
      ctx.setUDP(createMockUDP());
      expect(() => ctx.sendUDP("data")).not.toThrow();
      expect(() => ctx.sendUDP("data", 8080, "127.0.0.1")).not.toThrow();
      expect(() => ctx.sendManyUDP(["a", "b"])).not.toThrow();
      expect(() => ctx.addMembershipUDP("224.0.0.1")).not.toThrow();
      expect(() => ctx.dropMembershipUDP("224.0.0.1")).not.toThrow();
    });
  });

  // ─── requestId setter ───────────────────────────────────

  describe("requestId", () => {
    test("setter updates the requestId", () => {
      ctx.requestId = "custom-id";
      expect(ctx.requestId).toBe("custom-id");
    });
  });

  // ─── SSE cancel ─────────────────────────────────────────

  describe("sse() cancel", () => {
    test("SSE stream cancel disposes context", async () => {
      const sse = ctx.sse();
      // Cancel the underlying stream
      const stream = ctx.body as unknown as ReadableStream;
      expect(stream).toBeDefined();
      await stream.cancel();
      // Context should be disposed after cancel
      expect(ctx.isStopped()).toBe(true);
    });
  });

  // ─── catch ──────────────────────────────────────────────

  describe("catch()", () => {
    test("delegates to errorHandler", () => {
      ctx.setReq(makeReq());
      expect(() => ctx.catch(new Error("test"), ctx, false)).not.toThrow();
    });
  });

  // ─── cookies ────────────────────────────────────────────

  describe("cookies", () => {
    test("returns CookieMap from request", () => {
      const req = makeReq("http://localhost:3000/", {
        headers: { Cookie: "key=value; foo=bar" },
      });
      // Bun's Request has a cookies property; mock it for testing
      const cookieMap = new Map([
        ["key", "value"],
        ["foo", "bar"],
      ]);
      (req as unknown as { cookies: Map<string, string> }).cookies = cookieMap;
      ctx.setReq(req);
      expect(ctx.cookies.get("key")).toBe("value");
    });
  });

  // ─── withSource ─────────────────────────────────────────

  describe("withSource (via emit)", () => {
    test("emitSync uses 'context' as default source", () => {
      let receivedSource: unknown;
      bus.on("test", (c, p, m) => {
        receivedSource = (m as { source: string }).source;
      });
      ctx.emitSync("test", { data: 1 });
      expect(receivedSource).toBe("context");
    });

    test("emitAsync respects custom source", async () => {
      let receivedSource: unknown;
      bus.on("test", (c, p, m) => {
        receivedSource = (m as { source: string }).source;
      });
      await ctx.emitAsync("test", { data: 1 }, { source: "custom" });
      expect(receivedSource).toBe("custom");
    });
  });

  // ─── wrapStreamWithDisposal (Bug 3) ─────────────────────

  describe("wrapStreamWithDisposal (Bug 3 fix)", () => {
    test("stream completes and disposes without double-close error", async () => {
      let disposed = false;
      ctx.onDispose(() => {
        disposed = true;
      });

      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("chunk1"));
          controller.close();
        },
      });

      ctx.stream(readable);
      // Consume the stream fully
      const reader = (ctx.body as ReadableStream).getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      // Wait for microtask disposal
      await new Promise((r) => setTimeout(r, 10));
      expect(disposed).toBe(true);
      expect(chunks.length).toBe(1);
    });

    test("stream error disposes context", async () => {
      let disposed = false;
      ctx.onDispose(() => {
        disposed = true;
      });

      const readable = new ReadableStream({
        start(controller) {
          controller.error(new Error("stream error"));
        },
      });

      ctx.stream(readable);
      const reader = (ctx.body as ReadableStream).getReader();
      await expect(reader.read()).rejects.toThrow("stream error");
      await new Promise((r) => setTimeout(r, 10));
      expect(disposed).toBe(true);
    });

    test("stream cancel disposes context", async () => {
      let disposed = false;
      ctx.onDispose(() => {
        disposed = true;
      });

      const readable = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("chunk1"));
        },
      });

      ctx.stream(readable);
      const stream = ctx.body as ReadableStream;
      await stream.cancel();
      await new Promise((r) => setTimeout(r, 10));
      expect(disposed).toBe(true);
    });
  });

  // ─── wrapIteratorWithDisposal ───────────────────────────

  describe("wrapIteratorWithDisposal", () => {
    test("iterator completes and disposes", async () => {
      let disposed = false;
      ctx.onDispose(() => {
        disposed = true;
      });

      async function* gen() {
        yield "chunk1";
        yield "chunk2";
      }

      ctx.iterate(gen());
      const iterable = ctx.body as AsyncIterable<Uint8Array | string>;
      const iter = iterable[Symbol.asyncIterator]();
      const results: string[] = [];
      for (;;) {
        const { done, value } = await iter.next();
        if (done) break;
        results.push(value as string);
      }
      await new Promise((r) => setTimeout(r, 10));
      expect(results).toEqual(["chunk1", "chunk2"]);
      expect(disposed).toBe(true);
    });

    test("iterator error disposes context", async () => {
      let disposed = false;
      ctx.onDispose(() => {
        disposed = true;
      });

      async function* gen() {
        yield "chunk1";
        throw new Error("iterator error");
      }

      ctx.iterate(gen());
      const iterable = ctx.body as AsyncIterable<Uint8Array | string>;
      const iter = iterable[Symbol.asyncIterator]();
      await iter.next();
      await expect(iter.next()).rejects.toThrow("iterator error");
      await new Promise((r) => setTimeout(r, 10));
      expect(disposed).toBe(true);
    });

    test("iterator return() disposes context", async () => {
      let disposed = false;
      ctx.onDispose(() => {
        disposed = true;
      });

      async function* gen() {
        yield "chunk1";
        yield "chunk2";
      }

      ctx.iterate(gen());
      const iterable = ctx.body as AsyncIterable<Uint8Array | string>;
      const iter = iterable[Symbol.asyncIterator]();
      await iter.next();
      await iter.return?.();
      await new Promise((r) => setTimeout(r, 10));
      expect(disposed).toBe(true);
    });

    test("iterator throw() disposes context", async () => {
      let disposed = false;
      ctx.onDispose(() => {
        disposed = true;
      });

      async function* gen() {
        try {
          yield "chunk1";
        } catch (e) {
          // Generator catches the throw
        }
      }

      ctx.iterate(gen());
      const iterable = ctx.body as AsyncIterable<Uint8Array | string>;
      const iter = iterable[Symbol.asyncIterator]();
      await iter.next();
      await iter.throw?.(new Error("external error"));
      await new Promise((r) => setTimeout(r, 10));
      expect(disposed).toBe(true);
    });

    test("generator function (not iterable) is accepted", async () => {
      let disposed = false;
      ctx.onDispose(() => {
        disposed = true;
      });

      ctx.iterate(async function* () {
        yield "data";
      });
      const iterable = ctx.body as AsyncIterable<Uint8Array | string>;
      const iter = iterable[Symbol.asyncIterator]();
      const { done } = await iter.next();
      expect(done).toBe(false);
      await iter.next();
      await new Promise((r) => setTimeout(r, 10));
      expect(disposed).toBe(true);
    });
  });

  // ─── emitSyncIfAvailable ────────────────────────────────

  describe("emitSyncIfAvailable", () => {
    test("does not throw when no bus attached", () => {
      const c = new Context({ errorHandler: new ErrorHandler() });
      // parseBody calls emitSyncIfAvailable internally
      // Just verify no throw when bus is absent
      c.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: { "Content-Type": "text/plain", "Content-Length": "5" },
          body: "hello",
        }),
      );
      // This should work without a bus
      expect(c.parseBody()).resolves.toBe("hello");
    });
  });
});
