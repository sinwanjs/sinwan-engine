import { describe, expect, test } from "bun:test";
import { GrpcContext, type GRPCData } from "../../src/context/grpc-context";
import { EventBus } from "../../src/event-bus";
import { ErrorHandler } from "../../src/error-handler";
import { HTTPRouter } from "../../src/routers/http-router";
import { Runtime } from "../../src/runtime";
import type { GRPCCallPayload } from "../../src/types";

function createGrpcContext(
  overrides?: Partial<{ bus: EventBus }>,
): GrpcContext {
  return new GrpcContext({
    errorHandler: new ErrorHandler(),
    ...overrides,
  });
}

function createGRPCData(): GRPCData {
  return {
    name: "svc",
    package: "pkg",
    service: "pkg.Service",
    method: "Get",
    path: "/pkg.Service/Get",
    kind: "unary",
    request: {},
    call: {},
    metadata: {},
    data: null,
  };
}

function createTestRuntime(): Runtime {
  return new Runtime({
    bus: new EventBus(),
    errorHandler: new ErrorHandler(),
    globalState: new Map<string, unknown>(),
    httpRouter: new HTTPRouter(),
    maxPoolSize: 10,
  });
}

describe("GrpcContext", () => {
  test("has the grpc protocol tag", () => {
    const ctx = createGrpcContext();
    expect(ctx.protocol).toBe("grpc");
  });

  describe("setGRPC()", () => {
    test("attaches the call data (roundtrip)", () => {
      const ctx = createGrpcContext();
      const grpc = createGRPCData();
      ctx.setGRPC(grpc);
      expect(ctx.grpc).toBe(grpc);
      expect(ctx.grpc?.service).toBe("pkg.Service");
      expect(ctx.grpc?.kind).toBe("unary");
    });

    // Ported from the all-in-one Context test (setGRPC section):
    // a minimal GRPCData without the optional `package`/`request` fields.
    test("attaches a minimal GRPCData without optional fields", () => {
      const ctx = createGrpcContext();
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
      expect(ctx.grpc?.package).toBeUndefined();
    });
  });

  describe("json()", () => {
    test("commits body and status code", () => {
      const ctx = createGrpcContext();
      ctx.json({ error: "denied" }, 403);
      expect(ctx.body).toEqual({ error: "denied" });
      expect(ctx.statusCode).toBe(403);
      expect(ctx.hasResponded()).toBe(true);
      expect(ctx.isStopped()).toBe(true);
    });

    test("defaults to status code 200", () => {
      const ctx = createGrpcContext();
      ctx.json({ ok: true });
      expect(ctx.body).toEqual({ ok: true });
      expect(ctx.statusCode).toBe(200);
    });

    test("defaults to the current status code", () => {
      const ctx = createGrpcContext();
      ctx.statusCode = 201;
      ctx.json({ ok: true });
      expect(ctx.statusCode).toBe(201);
    });

    test("throws on double response", () => {
      const ctx = createGrpcContext();
      ctx.json({ ok: true });
      expect(() => ctx.json({ ok: true })).toThrow(
        "Response already sent. Cannot set body more than once.",
      );
    });

    test("emits response:set when listeners exist", () => {
      const bus = new EventBus();
      const ctx = createGrpcContext({ bus });
      let payload: unknown;
      bus.on("response:set", (c, p) => {
        if (c === ctx) payload = p;
      });
      ctx.json({ error: "no" }, 401);
      expect(payload).toEqual({
        kind: "json",
        statusCode: 401,
        contentType: "application/json",
      });
    });

    test("does not emit response:set without a bus", () => {
      const ctx = createGrpcContext();
      expect(() => ctx.json({ ok: true }, 200)).not.toThrow();
      expect(ctx.body).toEqual({ ok: true });
    });

    test("does not emit response:set when the bus has no listeners", () => {
      const bus = new EventBus();
      const ctx = createGrpcContext({ bus });
      expect(() => ctx.json({ ok: true }, 200)).not.toThrow();
      expect(bus.hasListeners("response:set")).toBe(false);
    });

    test("emits context:stop through the attached bus", () => {
      const bus = new EventBus();
      const ctx = createGrpcContext({ bus });
      let stopped = false;
      bus.on("context:stop", (c) => {
        if (c === ctx) stopped = true;
      });
      ctx.json({ error: "denied" }, 403);
      expect(stopped).toBe(true);
    });
  });

  test("reset() clears grpc data, body, status code, and flags", () => {
    const ctx = createGrpcContext();
    ctx.setGRPC(createGRPCData());
    ctx.json({ ok: true }, 500);
    ctx.set("key", "value");
    ctx.reset({ errorHandler: new ErrorHandler() });
    expect(ctx.grpc).toBeUndefined();
    expect(ctx.body).toBeNull();
    expect(ctx.statusCode).toBe(200);
    expect(ctx.has("key")).toBe(false);
    expect(ctx.hasResponded()).toBe(false);
    expect(ctx.isStopped()).toBe(false);
  });

  // ─── State management via the GrpcContext subclass ──────

  describe("state management", () => {
    test("set/get/has/update/getOnce/clear roundtrip", () => {
      const ctx = createGrpcContext();
      ctx.set("user", { id: 1 });
      expect(ctx.get<{ id: number }>("user")).toEqual({ id: 1 });
      expect(ctx.has("user")).toBe(true);
      ctx.update<{ id: number }>("user", (prev) => ({
        ...(prev ?? { id: 0 }),
        id: 2,
      }));
      expect(ctx.get<{ id: number }>("user")).toEqual({ id: 2 });
      expect(ctx.getOnce<{ id: number }>("user")).toEqual({ id: 2 });
      expect(ctx.has("user")).toBe(false);
      ctx.set("temp", 1);
      expect(ctx.clear("temp")).toBe(true);
      expect(ctx.clear("missing")).toBe(false);
      ctx.set("a", 1);
      ctx.set("b", 2);
      ctx.clearAll();
      expect(ctx.has("a")).toBe(false);
      expect(ctx.has("b")).toBe(false);
    });

    test("exportState/importState/snapshot", () => {
      const ctx = createGrpcContext();
      ctx.set("public", "yes");
      ctx.set("_private", "hidden");
      expect(ctx.exportState()).toEqual({ public: "yes" });
      expect(ctx.snapshot()).toEqual({ public: "yes", _private: "hidden" });

      const other = createGrpcContext();
      other.importState({ imported: true });
      expect(other.get<boolean>("imported")).toBe(true);
    });

    test("global state roundtrip", () => {
      const globalState = new Map<string, unknown>();
      const ctx = new GrpcContext({
        errorHandler: new ErrorHandler(),
        global: globalState,
      });
      ctx.setGlobal("counter", 1);
      expect(ctx.getGlobal<number>("counter")).toBe(1);
      expect(ctx.hasGlobal("counter")).toBe(true);
      ctx.updateGlobal<number>("counter", (prev) => (prev ?? 0) + 1);
      expect(ctx.getGlobal<number>("counter")).toBe(2);
      expect(ctx.getGlobalOnce<number>("counter")).toBe(2);
      expect(ctx.hasGlobal("counter")).toBe(false);
      ctx.setGlobal("gone", 1);
      expect(ctx.clearGlobal("gone")).toBe(true);
      ctx.setGlobal("x", 1);
      ctx.clearAllGlobal();
      expect(ctx.hasGlobal("x")).toBe(false);
      expect(ctx.snapshotGlobal()).toEqual({});
    });

    test("requestId defaults to a generated value and can be overridden", () => {
      const ctx = createGrpcContext();
      expect(ctx.requestId).toMatch(/^sinwan-request-/);
      ctx.requestId = "custom-id";
      expect(ctx.requestId).toBe("custom-id");
    });
  });

  // ─── Flow control via the GrpcContext subclass ──────────

  describe("flow control", () => {
    test("stop() halts and emits context:stop", () => {
      const bus = new EventBus();
      const ctx = createGrpcContext({ bus });
      let stopped = false;
      bus.on("context:stop", (c) => {
        if (c === ctx) stopped = true;
      });
      expect(ctx.isStopped()).toBe(false);
      ctx.stop();
      expect(ctx.isStopped()).toBe(true);
      expect(stopped).toBe(true);
    });

    test("skip() sets the skip count and clearSkip() resets it", () => {
      const ctx = createGrpcContext();
      ctx.skip(3);
      expect(ctx.isSkipped()).toBe(true);
      expect(ctx.skipCount).toBe(3);
      ctx.skip(2);
      expect(ctx.skipCount).toBe(2);
      ctx.clearSkip();
      expect(ctx.isSkipped()).toBe(false);
      expect(ctx.skipCount).toBe(0);
    });

    test("skip() with a count below 1 is a no-op", () => {
      const ctx = createGrpcContext();
      ctx.skip(0);
      expect(ctx.isSkipped()).toBe(false);
      expect(ctx.skipCount).toBe(0);
    });

    test("respond() flags an early response", () => {
      const ctx = createGrpcContext();
      expect(ctx.isRespondEarly()).toBe(false);
      ctx.respond();
      expect(ctx.isRespondEarly()).toBe(true);
    });

    test("fail() records the error and clearFail() resets it", () => {
      const ctx = createGrpcContext();
      const error = new Error("boom");
      ctx.fail(error);
      expect(ctx.isFailed()).toBe(true);
      expect(ctx.failError).toBe(error);
      ctx.clearFail();
      expect(ctx.isFailed()).toBe(false);
      expect(ctx.failError).toBeNull();
    });
  });

  // ─── Disposal / pooling lifecycle ───────────────────────

  describe("disposal and pooling", () => {
    test("onDispose() runs callbacks on dispose()", () => {
      const ctx = createGrpcContext();
      let disposed = false;
      ctx.onDispose(() => {
        disposed = true;
      });
      ctx.dispose();
      expect(disposed).toBe(true);
    });

    test("onDispose() runs immediately when already disposed", () => {
      const ctx = createGrpcContext();
      ctx.dispose();
      let ran = false;
      ctx.onDispose(() => {
        ran = true;
      });
      expect(ran).toBe(true);
    });

    test("dispose() is idempotent", () => {
      const ctx = createGrpcContext();
      let count = 0;
      ctx.onDispose(() => {
        count += 1;
      });
      ctx.dispose();
      ctx.dispose();
      expect(count).toBe(1);
    });

    test("markReleased() guards double release", () => {
      const ctx = createGrpcContext();
      expect(ctx.markReleased()).toBe(false);
      expect(ctx.markReleased()).toBe(true);
    });

    test("Runtime pool reuses a released GrpcContext after reset", () => {
      const runtime = createTestRuntime();
      const first = runtime.acquireGrpcContext();
      expect(first).toBeInstanceOf(GrpcContext);
      expect(first.protocol).toBe("grpc");

      first.setGRPC(createGRPCData());
      first.json({ error: "denied" }, 403);
      first.set("stale", true);
      first.dispose();
      runtime.releaseContext(first);

      const second = runtime.acquireGrpcContext();
      expect(second).toBe(first);
      expect(second.grpc).toBeUndefined();
      expect(second.body).toBeNull();
      expect(second.statusCode).toBe(200);
      expect(second.hasResponded()).toBe(false);
      expect(second.isStopped()).toBe(false);
      expect(second.has("stale")).toBe(false);
    });
  });

  // ─── grpc:call listener rejection flow (runWithPattern) ─

  describe("grpc:call listener rejection flow", () => {
    test("a listener can reject the call via ctx.json() and the server reads body/statusCode", async () => {
      const runtime = createTestRuntime();
      const ctx = runtime.acquireGrpcContext();
      const grpc = createGRPCData();
      ctx.setGRPC(grpc);

      const info: GRPCCallPayload = {
        name: grpc.name,
        package: grpc.package,
        service: grpc.service,
        method: grpc.method,
        path: grpc.path,
        kind: grpc.kind,
        request: grpc.request,
        metadata: grpc.metadata,
        data: grpc.data,
      };

      // The grpc:call listener rejects the call with an HTTP-shaped response,
      // exactly like Sinwan middleware does on the all-in-one Context.
      runtime.bus.on("grpc:call", (c, payload) => {
        expect(c).toBe(ctx);
        expect(payload).toEqual(info);
        ctx.json({ error: "missing credentials" }, 401);
      });

      const result = await runtime.bus.emitAsync("grpc:call", ctx, info, {
        source: "grpc-router",
      });
      // ctx.json() sets the STOPPED flag, so the emission halts with "STOP".
      // runWithContext still catches this: it checks ctx.hasResponded()
      // BEFORE ctx.isStopped() and converts via responseToGRPCError(ctx).
      expect(result).toBe("STOP");

      // responseToGRPCError(ctx) reads ctx.body and ctx.statusCode.
      expect(ctx.hasResponded()).toBe(true);
      expect(ctx.isStopped()).toBe(true);
      const body = ctx.body as { error?: string; message?: string };
      expect(typeof body.error === "string" ? body.error : body.message).toBe(
        "missing credentials",
      );
      expect(ctx.statusCode).toBe(401);

      ctx.dispose();
      runtime.releaseContext(ctx);
    });

    test("a STOP result makes the server call ctx.stop() before the handler", async () => {
      const runtime = createTestRuntime();
      const ctx = runtime.acquireGrpcContext();
      ctx.setGRPC(createGRPCData());

      runtime.bus.on("grpc:call", () => "STOP");

      const result = await runtime.bus.emitAsync(
        "grpc:call",
        ctx,
        {
          name: "svc",
          service: "pkg.Service",
          method: "Get",
          path: "/pkg.Service/Get",
          kind: "unary",
          metadata: {},
          data: null,
        },
        { source: "grpc-router" },
      );
      expect(result).toBe("STOP");

      // Mirrors runWithContext: STOP → ctx.stop() → PERMISSION_DENIED error.
      ctx.stop();
      expect(ctx.isStopped()).toBe(true);
      expect(ctx.hasResponded()).toBe(false);

      ctx.dispose();
      runtime.releaseContext(ctx);
    });
  });
});
