import { describe, expect, test, beforeEach, mock, spyOn } from "bun:test";
import {
  HttpContext,
  type HttpContext as HttpContextType,
} from "../../src/context/http-context";
import { EventBus } from "../../src/event-bus";
import { ErrorHandler } from "../../src/error-handler";
import { buildResponse } from "../../src/response";
import type { ContextOptions } from "../../src/context/base-context";
import type { Request } from "../../src/types";

// ─── Local factories (do NOT edit __test__/helpers.ts) ────

function makeCtx(overrides?: Partial<ContextOptions>): HttpContext {
  const bus = overrides?.bus ?? new EventBus();
  return new HttpContext({
    bus,
    errorHandler: new ErrorHandler(),
    ...overrides,
  });
}

function makeReq(
  url: string = "http://localhost:3000/path?query=1",
  opts: RequestInit = {},
): Request {
  return new Request(url, opts) as unknown as Request;
}

describe("HttpContext", () => {
  let bus: EventBus;
  let ctx: HttpContext;

  beforeEach(() => {
    bus = new EventBus();
    ctx = makeCtx({ bus });
  });

  // ─── Constructor / protocol ─────────────────────────────

  describe("constructor", () => {
    test("has the http protocol tag", () => {
      expect(ctx.protocol).toBe("http");
    });

    test("initializes HTTP fields with default values", () => {
      expect(ctx.statusCode).toBe(200);
      expect(ctx.body).toBeNull();
      expect(ctx.pathname).toBe("");
      expect(ctx.params).toEqual({});
      expect(ctx.maxBodySize).toBe(10 * 1024 * 1024);
    });

    test("accepts custom requestId", () => {
      const c = makeCtx({ requestId: "custom-id" });
      expect(c.requestId).toBe("custom-id");
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
      ctx.setReq(makeReq("http://localhost:3000/users/123?filter=active"));
      expect(ctx.pathname).toBe("/users/123");
    });

    test("pathname without query string", () => {
      ctx.setReq(makeReq("http://localhost:3000/users/123"));
      expect(ctx.pathname).toBe("/users/123");
    });

    test("pathname with no path segment", () => {
      ctx.setReq(makeReq("http://localhost:3000"));
      expect(ctx.pathname).toBe("/");
    });

    test("pathname strips hash fragment", () => {
      ctx.setReq(makeReq("http://localhost:3000/path#section"));
      expect(ctx.pathname).toBe("/path");
    });

    test("pathname strips trailing slash (except root)", () => {
      ctx.setReq(makeReq("http://localhost:3000/users/"));
      expect(ctx.pathname).toBe("/users");
    });

    test("root pathname with trailing slash stays root", () => {
      ctx.setReq(makeReq("http://localhost:3000/"));
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
      expect(ctx.query).toBe(ctx.query);
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
      bus.on("header:set", (_c, payload) => {
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
      bus.on("response:set", (_c, payload) => {
        emitted = true;
        expect((payload as { kind: string }).kind).toBe("json");
      });
      ctx.json({ data: 1 });
      expect(emitted).toBe(true);
    });

    test("ctx.once('response:set') is the after-response hook", () => {
      let afterStatus: number | undefined;
      ctx.once("response:set", (_c, payload) => {
        afterStatus = (payload as { statusCode: number }).statusCode;
      });
      ctx.json({ ok: true }, 201);
      expect(afterStatus).toBe(201);
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
      expect(() => ctx.redirectWith("/new", { flash: "leaked" })).toThrow(
        "Response already sent",
      );
      expect(Object.keys(ctx.snapshotGlobal()).length).toBe(0);
    });
  });

  describe("redirectData()", () => {
    test("retrieves and consumes redirect data", () => {
      ctx.setReq(makeReq("http://localhost:3000/new?redirect=id_abc123"));
      ctx.setGlobal("id_abc123", { flash: "success" });
      const data = ctx.redirectData<{ flash: string }>();
      expect(data).toEqual({ flash: "success" });
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

  // ─── notFound() / badRequest() ───────────────────────────

  describe("notFound()", () => {
    test("sets 404 with default message", () => {
      ctx.httpRespond.notFound();
      expect(ctx.hasResponded()).toBe(true);
      expect(ctx.statusCode).toBe(404);
      expect(ctx.body).toEqual({ error: "Not Found" });
    });

    test("sets 404 with custom message", () => {
      ctx.httpRespond.notFound("User not found");
      expect(ctx.statusCode).toBe(404);
      expect(ctx.body).toEqual({ error: "User not found" });
    });
  });

  describe("badRequest()", () => {
    test("sets 400 with default message", () => {
      ctx.httpRespond.badRequest();
      expect(ctx.hasResponded()).toBe(true);
      expect(ctx.statusCode).toBe(400);
      expect(ctx.body).toEqual({ error: "Bad Request" });
    });

    test("sets 400 with custom message", () => {
      ctx.httpRespond.badRequest("Invalid email");
      expect(ctx.statusCode).toBe(400);
      expect(ctx.body).toEqual({ error: "Invalid email" });
    });
  });

  // ─── HTTP status helper methods (1xx–5xx) ────────────────

  describe("status helpers", () => {
    const successCases: Array<
      [string, number, keyof HttpContextType["httpRespond"]]
    > = [
      ["continue", 100, "continue"],
      ["switchingProtocols", 101, "switchingProtocols"],
      ["processing", 102, "processing"],
      ["earlyHints", 103, "earlyHints"],
      ["ok", 200, "ok"],
      ["created", 201, "created"],
      ["accepted", 202, "accepted"],
      ["nonAuthoritativeInformation", 203, "nonAuthoritativeInformation"],
      ["noContent", 204, "noContent"],
      ["resetContent", 205, "resetContent"],
      ["partialContent", 206, "partialContent"],
      ["multiStatus", 207, "multiStatus"],
      ["alreadyReported", 208, "alreadyReported"],
      ["imUsed", 226, "imUsed"],
      ["multipleChoices", 300, "multipleChoices"],
      ["movedPermanently", 301, "movedPermanently"],
      ["found", 302, "found"],
      ["seeOther", 303, "seeOther"],
      ["notModified", 304, "notModified"],
      ["useProxy", 305, "useProxy"],
      ["temporaryRedirect", 307, "temporaryRedirect"],
      ["permanentRedirect", 308, "permanentRedirect"],
    ];

    const errorCases: Array<
      [string, number, keyof HttpContextType["httpRespond"]]
    > = [
      ["badRequest", 400, "badRequest"],
      ["unauthorized", 401, "unauthorized"],
      ["paymentRequired", 402, "paymentRequired"],
      ["forbidden", 403, "forbidden"],
      ["notFound", 404, "notFound"],
      ["methodNotAllowed", 405, "methodNotAllowed"],
      ["notAcceptable", 406, "notAcceptable"],
      ["proxyAuthenticationRequired", 407, "proxyAuthenticationRequired"],
      ["requestTimeout", 408, "requestTimeout"],
      ["conflict", 409, "conflict"],
      ["gone", 410, "gone"],
      ["lengthRequired", 411, "lengthRequired"],
      ["preconditionFailed", 412, "preconditionFailed"],
      ["payloadTooLarge", 413, "payloadTooLarge"],
      ["uriTooLong", 414, "uriTooLong"],
      ["unsupportedMediaType", 415, "unsupportedMediaType"],
      ["rangeNotSatisfiable", 416, "rangeNotSatisfiable"],
      ["expectationFailed", 417, "expectationFailed"],
      ["imATeapot", 418, "imATeapot"],
      ["misdirectedRequest", 421, "misdirectedRequest"],
      ["unprocessableEntity", 422, "unprocessableEntity"],
      ["locked", 423, "locked"],
      ["failedDependency", 424, "failedDependency"],
      ["tooEarly", 425, "tooEarly"],
      ["upgradeRequired", 426, "upgradeRequired"],
      ["preconditionRequired", 428, "preconditionRequired"],
      ["tooManyRequests", 429, "tooManyRequests"],
      ["requestHeaderFieldsTooLarge", 431, "requestHeaderFieldsTooLarge"],
      ["unavailableForLegalReasons", 451, "unavailableForLegalReasons"],
      ["internalServerError", 500, "internalServerError"],
      ["notImplemented", 501, "notImplemented"],
      ["badGateway", 502, "badGateway"],
      ["serviceUnavailable", 503, "serviceUnavailable"],
      ["gatewayTimeout", 504, "gatewayTimeout"],
    ];

    for (const [name, status, method] of successCases) {
      test(`${name}() sets ${status} with default message`, () => {
        (ctx.httpRespond[method] as (m?: string) => void)();
        expect(ctx.statusCode).toBe(status);
        expect(ctx.body).toEqual({ message: expect.any(String) });
        expect(ctx.hasResponded()).toBe(true);
      });

      test(`${name}() sets ${status} with custom message`, () => {
        (ctx.httpRespond[method] as (m?: string) => void)("custom");
        expect(ctx.body).toEqual({ message: "custom" });
      });
    }

    for (const [name, status, method] of errorCases) {
      test(`${name}() sets ${status} with default error message`, () => {
        (ctx.httpRespond[method] as (m?: string) => void)();
        expect(ctx.statusCode).toBe(status);
        expect(ctx.body).toEqual({ error: expect.any(String) });
        expect(ctx.hasResponded()).toBe(true);
      });

      test(`${name}() sets ${status} with custom error message`, () => {
        (ctx.httpRespond[method] as (m?: string) => void)("custom");
        expect(ctx.body).toEqual({ error: "custom" });
      });
    }
  });

  // ─── httpRespond instance-copy semantics ─────────────────

  describe("httpRespond instance-copy", () => {
    test("ctx.ok is the same function as ctx.httpRespond.ok", () => {
      expect(ctx.ok).toBe(ctx.httpRespond.ok);
    });

    test("calling ctx.ok() directly works", () => {
      ctx.ok("hello");
      expect(ctx.statusCode).toBe(200);
      expect(ctx.body).toEqual({ message: "hello" });
    });

    test("calling ctx.notFound() directly works", () => {
      ctx.notFound("nope");
      expect(ctx.statusCode).toBe(404);
      expect(ctx.body).toEqual({ error: "nope" });
    });
  });

  // ─── stream() ───────────────────────────────────────────

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

  // ─── iterate() ──────────────────────────────────────────

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

  // ─── sse() ──────────────────────────────────────────────

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

    test("send() writes data lines", () => {
      const controller = ctx.sse();
      controller.send("hello", "custom-event", "42", 5000);
      controller.close();
    });

    test("send() with object data", () => {
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
      controller.close(); // double close should not throw
    });

    test("custom status", () => {
      ctx.sse({ status: 201 });
      expect(ctx.statusCode).toBe(201);
    });

    test("retry option sends retry field", () => {
      ctx.sse({ retry: 3000 });
    });

    test("throws on double response", () => {
      ctx.json({});
      expect(() => ctx.sse()).toThrow("Response already sent");
    });
  });

  // ─── buffer() ───────────────────────────────────────────

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

  // ─── file() ─────────────────────────────────────────────

  describe("file()", () => {
    test("sets file response with inferred content type", () => {
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
      expect(await ctx.parseBody<Record<string, unknown>>()).toEqual({
        key: "value",
      });
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
      expect(await ctx.parseBody<string>()).toBe("hello");
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
      bus.on("body:parsed", (_c, payload) => {
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
      bus.on("body:parse:error", () => {
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
        /* expected */
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
      expect(await ctx.parseBody<Record<string, unknown>>()).toEqual({
        key: "value",
      });
    });

    test("text without content-length uses streaming size enforcement", async () => {
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "hello world",
        }),
      );
      expect(await ctx.parseBody<string>()).toBe("hello world");
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
      expect(await ctx.parseBody<string>()).toBe("");
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

    test("fallback blob path for malformed multipart", async () => {
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: {
            "Content-Type": "multipart/form-data; boundary=abc",
            "Content-Length": "20",
          },
          body: "not-real-form-data!!",
        }),
      );
      await expect(ctx.formData()).rejects.toThrow();
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

    test("throws 413 for oversized file", async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new File(["x".repeat(100)], "t.txt", { type: "text/plain" }),
      );
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
        ctx.saveFile("file", "/tmp/t.txt", { maxSize: 10 }),
      ).rejects.toThrow("File too large");
    });

    test("throws 415 for wrong file type", async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new File(["content"], "t.txt", { type: "text/plain" }),
      );
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
        ctx.saveFile("file", "/tmp/t.txt", { allowedTypes: ["image/png"] }),
      ).rejects.toThrow("Invalid file type");
    });

    test("writes file and emits file:saved event", async () => {
      let emitted = false;
      bus.on("file:saved", () => {
        emitted = true;
      });
      const formData = new FormData();
      formData.append(
        "file",
        new File(["hello"], "t.txt", { type: "text/plain" }),
      );
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
      const bytes = await ctx.saveFile("file", "/tmp/test-save-ok.txt");
      expect(bytes).toBeGreaterThan(0);
      expect(emitted).toBe(true);
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

    test("saves files via saveFiles and returns bytes map", async () => {
      const formData = new FormData();
      formData.append(
        "file",
        new File(["content"], "f.txt", { type: "text/plain" }),
      );
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
      const result = await ctx.saveFiles([
        { field: "file", dest: "/tmp/test-savefiles-ok.txt" },
      ]);
      expect(result.get("file")).toBeGreaterThan(0);
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
      expect(called).toBe(false);
    });
  });

  // ─── catch ──────────────────────────────────────────────

  describe("catch()", () => {
    test("delegates to errorHandler", () => {
      ctx.setReq(makeReq());
      expect(() => ctx.catch(new Error("test"), ctx, false)).not.toThrow();
    });

    test("single-arg form sets an error response", async () => {
      ctx.setReq(makeReq());
      await ctx.catch(new Error("boom"));
      expect(ctx.hasResponded()).toBe(true);
      expect(ctx.statusCode).toBe(500);
    });

    test("single-arg form with statusCode error preserves status", async () => {
      ctx.setReq(makeReq());
      const err = new Error("Not found") as Error & { statusCode: number };
      err.statusCode = 404;
      await ctx.catch(err);
      expect(ctx.statusCode).toBe(404);
    });
  });

  // ─── cookies ────────────────────────────────────────────

  describe("cookies", () => {
    test("parses cookies from the Cookie header", () => {
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          headers: { Cookie: "key=value; foo=bar" },
        }),
      );
      expect(ctx.cookies.get("key")).toBe("value");
      expect(ctx.cookies.get("foo")).toBe("bar");
    });

    test("returns empty CookieMap when no Cookie header is present", () => {
      ctx.setReq(makeReq("http://localhost:3000/"));
      expect(ctx.cookies.get("missing")).toBeNull();
    });

    test("caches the CookieMap across accesses", () => {
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          headers: { Cookie: "session=abc" },
        }),
      );
      expect(ctx.cookies).toBe(ctx.cookies);
      expect(ctx.cookies.get("session")).toBe("abc");
    });

    test("reset() clears the cached CookieMap", () => {
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          headers: { Cookie: "session=abc" },
        }),
      );
      expect(ctx.cookies.get("session")).toBe("abc");

      ctx.reset({ requestId: "r2" } as unknown as ContextOptions);
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          headers: { Cookie: "session=xyz" },
        }),
      );
      expect(ctx.cookies.get("session")).toBe("xyz");
    });

    test("ctx.cookies.set(name, value) adds a cookie", () => {
      ctx.setReq(makeReq("http://localhost:3000/"));
      ctx.cookies.set("session", "abc123");
      expect(ctx.cookieHeaders()).toEqual([
        "session=abc123; Path=/; SameSite=Lax",
      ]);
      expect(ctx.hasHeaders()).toBe(false);
    });

    test("ctx.cookies.set(name, value, options) serializes options", () => {
      ctx.setReq(makeReq("http://localhost:3000/"));
      ctx.cookies.set("session", "abc", {
        httpOnly: true,
        secure: true,
        maxAge: 3600,
        sameSite: "strict",
        path: "/admin",
      });
      const cookies = ctx.cookieHeaders();
      expect(cookies.length).toBe(1);
      expect(cookies[0]).toContain("session=abc");
      expect(cookies[0]).toContain("Path=/admin");
      expect(cookies[0]).toContain("Max-Age=3600");
      expect(cookies[0]).toContain("Secure");
      expect(cookies[0]).toContain("HttpOnly");
      expect(cookies[0]).toContain("SameSite=Strict");
    });

    test("ctx.cookies.set(options) object form works", () => {
      ctx.setReq(makeReq("http://localhost:3000/"));
      ctx.cookies.set({ name: "theme", value: "dark", secure: true });
      const cookies = ctx.cookieHeaders();
      expect(cookies.length).toBe(1);
      expect(cookies[0]).toContain("theme=dark");
      expect(cookies[0]).toContain("Secure");
    });

    test("ctx.cookies.set() appends multiple cookies (no overwrite)", () => {
      ctx.setReq(makeReq("http://localhost:3000/"));
      ctx.cookies.set("a", "1");
      ctx.cookies.set("b", "2");
      const cookies = ctx.cookieHeaders();
      expect(cookies.length).toBe(2);
      expect(cookies[0]).toContain("a=1");
      expect(cookies[1]).toContain("b=2");
    });

    test("ctx.cookies.delete(name) sets empty value with past expiry", () => {
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          headers: { Cookie: "session=abc" },
        }),
      );
      ctx.cookies.delete("session");
      const cookies = ctx.cookieHeaders();
      expect(cookies.length).toBe(1);
      expect(cookies[0]).toContain("session=");
      // Bun's CookieMap serializes the epoch as "Thu, 01 Jan 1970 00:00:00 GMT"
      expect(cookies[0]).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    });

    test("ctx.cookies.delete(name, options) with path", () => {
      ctx.setReq(makeReq("http://localhost:3000/"));
      ctx.cookies.delete("session", { path: "/admin" });
      const cookies = ctx.cookieHeaders();
      expect(cookies.length).toBe(1);
      expect(cookies[0]).toContain("session=");
      expect(cookies[0]).toContain("Path=/admin");
    });

    test("ctx.cookies.delete({ name, path }) object form", () => {
      ctx.setReq(makeReq("http://localhost:3000/"));
      ctx.cookies.delete({ name: "session", path: "/admin" });
      const cookies = ctx.cookieHeaders();
      expect(cookies.length).toBe(1);
      expect(cookies[0]).toContain("session=");
      expect(cookies[0]).toContain("Path=/admin");
    });

    test("buildResponse applies cookie headers as Set-Cookie", () => {
      ctx.setReq(makeReq("http://localhost:3000/"));
      ctx.cookies.set("session", "abc", { httpOnly: true });
      ctx.cookies.set("theme", "dark");
      ctx.json({ ok: true });
      const res = buildResponse(ctx);
      const setCookies = res.headers.getSetCookie();
      expect(setCookies.length).toBe(2);
      expect(setCookies[0]).toContain("session=abc");
      expect(setCookies[0]).toContain("HttpOnly");
      expect(setCookies[1]).toContain("theme=dark");
    });

    test("buildResponse applies ctx.cookies.delete() as Set-Cookie", () => {
      ctx.setReq(
        makeReq("http://localhost:3000/", {
          headers: { Cookie: "session=abc" },
        }),
      );
      ctx.cookies.delete("session");
      ctx.json({ ok: true });
      const res = buildResponse(ctx);
      const setCookies = res.headers.getSetCookie();
      expect(setCookies.length).toBe(1);
      expect(setCookies[0]).toContain("session=");
      expect(setCookies[0]).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    });

    test("cookieHeaders() returns empty array when cookies never accessed", () => {
      ctx.setReq(makeReq("http://localhost:3000/"));
      expect(ctx.cookieHeaders()).toEqual([]);
    });

    test("applyCookieHeaders() appends Set-Cookie headers", () => {
      ctx.setReq(makeReq("http://localhost:3000/"));
      ctx.cookies.set("session", "abc");
      ctx.cookies.set("theme", "dark");
      ctx.applyCookieHeaders();
      const setCookies = ctx.headers.getSetCookie();
      expect(setCookies.length).toBe(2);
      expect(setCookies[0]).toContain("session=abc");
      expect(setCookies[1]).toContain("theme=dark");
    });

    test("applyCookieHeaders() is a no-op when no cookies were set", () => {
      ctx.setReq(makeReq("http://localhost:3000/"));
      ctx.applyCookieHeaders();
      expect(ctx.hasHeaders()).toBe(false);
    });

    test("applyCookieHeaders() emits cookie:set event with header values", () => {
      const bus = new EventBus();
      ctx = new HttpContext({ bus, errorHandler: new ErrorHandler() });
      ctx.setReq(makeReq("http://localhost:3000/"));
      ctx.cookies.set("session", "abc", { httpOnly: true });
      ctx.cookies.set("theme", "dark");

      let emitted = false;
      let receivedHeaders: string[] = [];
      bus.on("cookie:set", (_c, payload) => {
        emitted = true;
        receivedHeaders = (payload as { headers: string[] }).headers;
      });
      ctx.applyCookieHeaders();
      expect(emitted).toBe(true);
      expect(receivedHeaders.length).toBe(2);
      expect(receivedHeaders[0]).toContain("session=abc");
      expect(receivedHeaders[0]).toContain("HttpOnly");
      expect(receivedHeaders[1]).toContain("theme=dark");
    });

    test("applyCookieHeaders() does not emit when no bus listeners", () => {
      ctx.setReq(makeReq("http://localhost:3000/"));
      ctx.cookies.set("session", "abc");
      // No bus attached — should not throw
      ctx.applyCookieHeaders();
      expect(ctx.headers.getSetCookie().length).toBe(1);
    });

    test("buildResponse emits cookie:set event", () => {
      const bus = new EventBus();
      ctx = new HttpContext({ bus, errorHandler: new ErrorHandler() });
      ctx.setReq(makeReq("http://localhost:3000/"));
      ctx.cookies.set("session", "abc");
      ctx.json({ ok: true });

      let emitted = false;
      let receivedHeaders: string[] = [];
      bus.on("cookie:set", (_c, payload) => {
        emitted = true;
        receivedHeaders = (payload as { headers: string[] }).headers;
      });
      buildResponse(ctx);
      expect(emitted).toBe(true);
      expect(receivedHeaders.length).toBe(1);
      expect(receivedHeaders[0]).toContain("session=abc");
    });

    test("buildResponse does not emit cookie:set when no cookies set", () => {
      const bus = new EventBus();
      ctx = new HttpContext({ bus, errorHandler: new ErrorHandler() });
      ctx.setReq(makeReq("http://localhost:3000/"));
      ctx.json({ ok: true });

      let emitted = false;
      bus.on("cookie:set", () => {
        emitted = true;
      });
      buildResponse(ctx);
      expect(emitted).toBe(false);
    });
  });

  // ─── SSE cancel ─────────────────────────────────────────

  describe("sse() cancel", () => {
    test("SSE stream cancel disposes context", async () => {
      const sse = ctx.sse();
      const stream = ctx.body as unknown as ReadableStream;
      expect(stream).toBeDefined();
      await stream.cancel();
      expect(ctx.isStopped()).toBe(true);
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
      const reader = (ctx.body as ReadableStream).getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
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

    test("stream with pull-based source triggers wrapped pull()", async () => {
      let disposed = false;
      ctx.onDispose(() => {
        disposed = true;
      });

      let pullCount = 0;
      const source = new ReadableStream({
        pull(controller) {
          pullCount++;
          if (pullCount <= 3) {
            controller.enqueue(new TextEncoder().encode(`chunk${pullCount}`));
          } else {
            controller.close();
          }
        },
      });

      ctx.stream(source);
      const reader = (ctx.body as ReadableStream).getReader();
      const chunks: string[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(new TextDecoder().decode(value));
      }
      await new Promise((r) => setTimeout(r, 10));
      expect(disposed).toBe(true);
      expect(chunks).toEqual(["chunk1", "chunk2", "chunk3"]);
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
        } catch {
          /* generator catches */
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

  // ─── emitSyncIfAvailable (HTTP-specific: parseBody without bus) ──

  describe("emitSyncIfAvailable (parseBody without bus)", () => {
    test("does not throw when no bus attached", () => {
      const c = new HttpContext({ errorHandler: new ErrorHandler() });
      c.setReq(
        makeReq("http://localhost:3000/", {
          method: "POST",
          headers: { "Content-Type": "text/plain", "Content-Length": "5" },
          body: "hello",
        }),
      );
      expect(c.parseBody<string>()).resolves.toBe("hello");
    });
  });

  // ─── server methods ─────────────────────────────────────

  describe("server methods", () => {
    test("clientIP returns undefined without server", () => {
      const c = new HttpContext({ errorHandler: new ErrorHandler() });
      expect(c.clientIP).toBeUndefined();
    });

    test("setTimeout does nothing without server", () => {
      const c = new HttpContext({ errorHandler: new ErrorHandler() });
      expect(() => c.setTimeout(30)).not.toThrow();
    });
  });
});
