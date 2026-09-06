import { describe, expect, test } from "bun:test";
import {
  BaseContext,
  type ContextOptions,
} from "../../src/context/base-context";
import { EventBus } from "../../src/event-bus";
import { ErrorHandler } from "../../src/error-handler";
import type { EventMeta } from "../../src/types";

class TestContext extends BaseContext {
  public readonly protocol = "http" as const;

  testMarkStreaming(): void {
    this._status |= BaseContext.STREAMING;
  }

  testMarkResponded(): void {
    this._status |= BaseContext.RESPONDED;
  }

  testGuardDoubleResponse(): void {
    this.guardDoubleResponse();
  }

  testEmitSyncIfAvailable(event: string, payload?: unknown): void {
    this.emitSyncIfAvailable(event, payload);
  }
}

function createTestBaseContext(
  overrides?: Partial<ContextOptions>,
): TestContext {
  return new TestContext({
    errorHandler: new ErrorHandler(),
    ...overrides,
  });
}

function makeMeta(seq: number): EventMeta {
  return {
    name: "test:event",
    event: "test:event",
    timestamp: seq,
    sequence: seq,
    requestId: "req-1",
    source: "context",
  };
}

describe("BaseContext", () => {
  // ─── requestId ────────────────────────────────────────────

  describe("requestId", () => {
    test("lazily generates a request id", () => {
      const ctx = createTestBaseContext();
      const id = ctx.requestId;
      expect(id.startsWith("sinwan-request-")).toBe(true);
      expect(ctx.requestId).toBe(id);
    });

    test("uses provided request id and allows overriding", () => {
      const ctx = createTestBaseContext({ requestId: "custom-1" });
      expect(ctx.requestId).toBe("custom-1");
      ctx.requestId = "custom-2";
      expect(ctx.requestId).toBe("custom-2");
    });
  });

  // ─── State Management ─────────────────────────────────────

  describe("state", () => {
    test("set() / get() / has()", () => {
      const ctx = createTestBaseContext();
      ctx.set("key", "value");
      expect(ctx.get<string>("key")).toBe("value");
      expect(ctx.has("key")).toBe(true);
      expect(ctx.has("missing")).toBe(false);
    });

    test("get() returns undefined for missing keys", () => {
      const ctx = createTestBaseContext();
      expect(ctx.get<string>("missing")).toBeUndefined();
    });

    test("getOnce() returns value and removes it", () => {
      const ctx = createTestBaseContext();
      ctx.set("key", "value");
      expect(ctx.getOnce<string>("key")).toBe("value");
      expect(ctx.has("key")).toBe(false);
    });

    test("update() applies updater to previous value", () => {
      const ctx = createTestBaseContext();
      ctx.set("count", 1);
      const next = ctx.update<number>("count", (prev) => (prev ?? 0) + 1);
      expect(next).toBe(2);
      expect(ctx.get<number>("count")).toBe(2);
    });

    test("clear() removes a single key", () => {
      const ctx = createTestBaseContext();
      ctx.set("key", "value");
      expect(ctx.clear("key")).toBe(true);
      expect(ctx.clear("key")).toBe(false);
    });

    test("clearAll() removes all keys", () => {
      const ctx = createTestBaseContext();
      ctx.set("a", 1);
      ctx.set("b", 2);
      ctx.clearAll();
      expect(ctx.has("a")).toBe(false);
      expect(ctx.has("b")).toBe(false);
    });

    test("snapshot() freezes current state", () => {
      const ctx = createTestBaseContext();
      ctx.set("a", 1);
      const snap = ctx.snapshot();
      expect(snap).toEqual({ a: 1 });
    });

    test("exportState() excludes underscore-prefixed keys", () => {
      const ctx = createTestBaseContext();
      ctx.set("public", 1);
      ctx.set("_private", 2);
      expect(ctx.exportState()).toEqual({ public: 1 });
    });

    test("importState() copies entries into state", () => {
      const ctx = createTestBaseContext();
      ctx.importState({ a: 1, b: 2 });
      expect(ctx.get<number>("a")).toBe(1);
      expect(ctx.get<number>("b")).toBe(2);
    });
  });

  // ─── Global State Management ──────────────────────────────

  describe("global state", () => {
    test("setGlobal() / getGlobal() / hasGlobal()", () => {
      const ctx = createTestBaseContext();
      ctx.setGlobal("key", "value");
      expect(ctx.getGlobal<string>("key")).toBe("value");
      expect(ctx.hasGlobal("key")).toBe(true);
    });

    test("getGlobalOnce() returns value and removes it", () => {
      const ctx = createTestBaseContext();
      ctx.setGlobal("key", "value");
      expect(ctx.getGlobalOnce<string>("key")).toBe("value");
      expect(ctx.hasGlobal("key")).toBe(false);
    });

    test("updateGlobal() applies updater", () => {
      const ctx = createTestBaseContext();
      ctx.setGlobal("count", 10);
      expect(ctx.updateGlobal<number>("count", (prev) => (prev ?? 0) + 5)).toBe(
        15,
      );
    });

    test("clearGlobal() removes a single key", () => {
      const ctx = createTestBaseContext();
      ctx.setGlobal("key", "value");
      expect(ctx.clearGlobal("key")).toBe(true);
      expect(ctx.clearGlobal("key")).toBe(false);
    });

    test("clearAllGlobal() removes all keys", () => {
      const ctx = createTestBaseContext();
      ctx.setGlobal("a", 1);
      ctx.setGlobal("b", 2);
      ctx.clearAllGlobal();
      expect(ctx.hasGlobal("a")).toBe(false);
    });

    test("snapshotGlobal() freezes global state", () => {
      const shared = new Map<string, unknown>([["x", 1]]);
      const ctx = createTestBaseContext({ global: shared });
      expect(ctx.snapshotGlobal()).toEqual({ x: 1 });
    });

    test("global defaults to an empty map", () => {
      const ctx = createTestBaseContext();
      ctx.setGlobal("key", "value");
      expect(ctx.getGlobal<string>("key")).toBe("value");
    });
  });

  // ─── Flow Control ─────────────────────────────────────────

  describe("flow control", () => {
    test("stop() marks stopped and emits context:stop", () => {
      const bus = new EventBus();
      const ctx = createTestBaseContext({ bus });
      let stopped = false;
      bus.on("context:stop", () => {
        stopped = true;
      });
      expect(ctx.isStopped()).toBe(false);
      ctx.stop();
      expect(ctx.isStopped()).toBe(true);
      expect(stopped).toBe(true);
    });

    test("stop() without listeners does not throw", () => {
      const ctx = createTestBaseContext();
      ctx.stop();
      expect(ctx.isStopped()).toBe(true);
    });

    test("hasResponded() reflects RESPONDED flag", () => {
      const ctx = createTestBaseContext();
      expect(ctx.hasResponded()).toBe(false);
      ctx.testMarkResponded();
      expect(ctx.hasResponded()).toBe(true);
    });

    test("isStreaming() reflects STREAMING flag", () => {
      const ctx = createTestBaseContext();
      expect(ctx.isStreaming()).toBe(false);
      ctx.testMarkStreaming();
      expect(ctx.isStreaming()).toBe(true);
    });

    test("skip() sets flag and count", () => {
      const ctx = createTestBaseContext();
      ctx.skip(3);
      expect(ctx.isSkipped()).toBe(true);
      expect(ctx.skipCount).toBe(3);
    });

    test("skip() with count < 1 is a no-op", () => {
      const ctx = createTestBaseContext();
      ctx.skip(0);
      expect(ctx.isSkipped()).toBe(false);
      expect(ctx.skipCount).toBe(0);
    });

    test("clearSkip() resets flag and count", () => {
      const ctx = createTestBaseContext();
      ctx.skip(2);
      ctx.clearSkip();
      expect(ctx.isSkipped()).toBe(false);
      expect(ctx.skipCount).toBe(0);
    });

    test("respond() / isRespondEarly()", () => {
      const ctx = createTestBaseContext();
      expect(ctx.isRespondEarly()).toBe(false);
      ctx.respond();
      expect(ctx.isRespondEarly()).toBe(true);
    });

    test("fail() / isFailed() / failError / clearFail()", () => {
      const ctx = createTestBaseContext();
      const err = new Error("boom");
      ctx.fail(err);
      expect(ctx.isFailed()).toBe(true);
      expect(ctx.failError).toBe(err);
      ctx.clearFail();
      expect(ctx.isFailed()).toBe(false);
      expect(ctx.failError).toBeNull();
    });
  });

  // ─── EventBus Interaction ─────────────────────────────────

  describe("EventBus interaction", () => {
    test("attachBus() attaches a bus", () => {
      const bus = new EventBus();
      const ctx = createTestBaseContext();
      ctx.attachBus(bus);
      ctx.emitSync("custom:event", { ok: true });
    });

    test("attachBus() throws when a different bus is already attached", () => {
      const ctx = createTestBaseContext({ bus: new EventBus() });
      expect(() => ctx.attachBus(new EventBus())).toThrow(
        "Context is already attached to a different EventBus.",
      );
    });

    test("attachBus() allows re-attaching the same bus", () => {
      const bus = new EventBus();
      const ctx = createTestBaseContext({ bus });
      ctx.attachBus(bus);
    });

    test("emitSync() throws when no bus is attached", () => {
      const ctx = createTestBaseContext();
      expect(() => ctx.emitSync("custom:event")).toThrow(
        "Context is not attached to an EventBus.",
      );
    });

    test("emitAsync() throws when no bus is attached", async () => {
      const ctx = createTestBaseContext();
      expect(ctx.emitAsync("custom:event")).rejects.toThrow(
        "Context is not attached to an EventBus.",
      );
    });

    test("emitSync() delivers payload and default source", () => {
      const bus = new EventBus();
      const ctx = createTestBaseContext({ bus });
      let received: unknown;
      let source: unknown;
      bus.on("custom:event", (c, payload, meta) => {
        if (c === ctx) {
          received = payload;
          source = meta?.source;
        }
      });
      ctx.emitSync("custom:event", { hello: "world" });
      expect(received).toEqual({ hello: "world" });
      expect(source).toBe("context");
    });

    test("emitAsync() delivers payload", async () => {
      const bus = new EventBus();
      const ctx = createTestBaseContext({ bus });
      let received: unknown;
      bus.on("custom:event", (c, payload) => {
        if (c === ctx) received = payload;
      });
      await ctx.emitAsync("custom:event", 42);
      expect(received).toBe(42);
    });

    test("emitSyncIfAvailable() is a no-op without a bus", () => {
      const ctx = createTestBaseContext();
      ctx.testEmitSyncIfAvailable("custom:event");
    });

    test("emitSyncIfAvailable() emits when a bus is attached", () => {
      const bus = new EventBus();
      const ctx = createTestBaseContext({ bus });
      let received: unknown;
      bus.on("custom:event", (c, payload) => {
        if (c === ctx) received = payload;
      });
      ctx.testEmitSyncIfAvailable("custom:event", "data");
      expect(received).toBe("data");
    });
  });

  // ─── Scoped Listeners ─────────────────────────────────────

  describe("scoped listeners", () => {
    test("on() registers a scoped listener that fires for this context", () => {
      const bus = new EventBus();
      const ctx = createTestBaseContext({ bus });
      let called = 0;
      ctx.on("custom:event", () => {
        called += 1;
      });
      bus.emitSync("custom:event", ctx);
      expect(called).toBe(1);
    });

    test("scoped listener does not fire for other contexts", () => {
      const bus = new EventBus();
      const ctx = createTestBaseContext({ bus });
      const other = createTestBaseContext({ bus });
      let called = 0;
      ctx.on("custom:event", () => {
        called += 1;
      });
      bus.emitSync("custom:event", other);
      expect(called).toBe(0);
    });

    test("once() listener fires a single time", () => {
      const bus = new EventBus();
      const ctx = createTestBaseContext({ bus });
      let called = 0;
      ctx.once("custom:event", () => {
        called += 1;
      });
      bus.emitSync("custom:event", ctx);
      bus.emitSync("custom:event", ctx);
      expect(called).toBe(1);
    });

    test("on() supports multiple registrations of the same handler", () => {
      const bus = new EventBus();
      const ctx = createTestBaseContext({ bus });
      let called = 0;
      const handler = (): void => {
        called += 1;
      };
      ctx.on("custom:event", handler);
      ctx.on("custom:event", handler);
      bus.emitSync("custom:event", ctx);
      expect(called).toBe(2);
    });

    test("off() removes the most recent registration", () => {
      const bus = new EventBus();
      const ctx = createTestBaseContext({ bus });
      let called = 0;
      const handler = (): void => {
        called += 1;
      };
      ctx.on("custom:event", handler);
      ctx.on("custom:event", handler);
      ctx.off("custom:event", handler);
      bus.emitSync("custom:event", ctx);
      expect(called).toBe(1);
    });

    test("off() with an untracked handler is a no-op", () => {
      const bus = new EventBus();
      const ctx = createTestBaseContext({ bus });
      ctx.off("custom:event", () => {});
      expect(bus.listenerCount("custom:event")).toBe(0);
    });

    test("dispose() removes scoped listeners from the bus", () => {
      const bus = new EventBus();
      const ctx = createTestBaseContext({ bus });
      ctx.on("custom:event", () => {});
      expect(bus.listenerCount("custom:event")).toBe(1);
      ctx.dispose();
      expect(bus.listenerCount("custom:event")).toBe(0);
    });
  });

  // ─── Disposal ─────────────────────────────────────────────

  describe("onDispose() / dispose()", () => {
    test("onDispose() callbacks run on dispose", () => {
      const ctx = createTestBaseContext();
      let ran = false;
      ctx.onDispose(() => {
        ran = true;
      });
      ctx.dispose();
      expect(ran).toBe(true);
    });

    test("onDispose() runs immediately when already disposed", () => {
      const ctx = createTestBaseContext();
      ctx.dispose();
      let ran = false;
      ctx.onDispose(() => {
        ran = true;
      });
      expect(ran).toBe(true);
    });

    test("dispose() is idempotent", () => {
      const ctx = createTestBaseContext();
      let count = 0;
      ctx.onDispose(() => {
        count += 1;
      });
      ctx.dispose();
      ctx.dispose();
      expect(count).toBe(1);
    });

    test("dispose() swallows callback errors", () => {
      const ctx = createTestBaseContext();
      let ran = false;
      ctx.onDispose(() => {
        throw new Error("callback error");
      });
      ctx.onDispose(() => {
        ran = true;
      });
      expect(() => ctx.dispose()).not.toThrow();
      expect(ran).toBe(true);
    });

    test("dispose() clears the streaming flag", () => {
      const ctx = createTestBaseContext();
      ctx.testMarkStreaming();
      ctx.dispose();
      expect(ctx.isStreaming()).toBe(false);
    });

    test("dispose() emits context:dispose when listeners exist", () => {
      const bus = new EventBus();
      const ctx = createTestBaseContext({ bus });
      let disposed = false;
      bus.on("context:dispose", (c) => {
        if (c === ctx) disposed = true;
      });
      ctx.dispose();
      expect(disposed).toBe(true);
    });

    test("dispose() emits context:dispose even when context is stopped", () => {
      const bus = new EventBus();
      const ctx = createTestBaseContext({ bus });
      ctx.stop(); // sets STOPPED flag
      let disposed = false;
      bus.on("context:dispose", (c) => {
        if (c === ctx) disposed = true;
      });
      ctx.dispose();
      expect(disposed).toBe(true);
    });
  });

  // ─── Event Trace ──────────────────────────────────────────

  describe("event trace", () => {
    test("recordEvent() appends entries in order", () => {
      const ctx = createTestBaseContext();
      ctx.recordEvent(makeMeta(1), "p1");
      ctx.recordEvent(makeMeta(2), "p2");
      const trace = ctx.getEventTrace();
      expect(trace.length).toBe(2);
      expect(trace[0]!.sequence).toBe(1);
      expect(trace[1]!.sequence).toBe(2);
    });

    test("recordEvent() is a no-op when tracing is disabled", () => {
      const ctx = createTestBaseContext({ trace: { enabled: false } });
      ctx.recordEvent(makeMeta(1), undefined);
      expect(ctx.getEventTrace().length).toBe(0);
    });

    test("recordEvent() is a no-op when maxEntries <= 0", () => {
      const ctx = createTestBaseContext({ trace: { maxEntries: 0 } });
      ctx.recordEvent(makeMeta(1), undefined);
      expect(ctx.getEventTrace().length).toBe(0);
    });

    test("recordEvent() stores payload when includePayload is set", () => {
      const ctx = createTestBaseContext({ trace: { includePayload: true } });
      ctx.recordEvent(makeMeta(1), { data: true });
      expect(ctx.getEventTrace()[0]!.payload).toEqual({ data: true });
    });

    test("ring buffer keeps the newest entries in order", () => {
      const ctx = createTestBaseContext({ trace: { maxEntries: 3 } });
      for (let i = 1; i <= 5; i++) {
        ctx.recordEvent(makeMeta(i), i);
      }
      const trace = ctx.getEventTrace();
      expect(trace.length).toBe(3);
      expect(trace.map((e) => e.sequence)).toEqual([3, 4, 5]);
    });
  });

  // ─── Reset & Release ──────────────────────────────────────

  describe("reset()", () => {
    test("clears shared state and flags", () => {
      const ctx = createTestBaseContext({ requestId: "r1" });
      ctx.set("key", "value");
      ctx.setGlobal("gkey", "gvalue");
      ctx.stop();
      ctx.skip(2);
      ctx.fail(new Error("x"));
      ctx.onDispose(() => {});
      ctx.reset({ requestId: "r2", errorHandler: new ErrorHandler() });

      expect(ctx.has("key")).toBe(false);
      expect(ctx.hasGlobal("gkey")).toBe(true); // global is shared app state, not per-request
      expect(ctx.isStopped()).toBe(false);
      expect(ctx.isSkipped()).toBe(false);
      expect(ctx.skipCount).toBe(0);
      expect(ctx.isFailed()).toBe(false);
      expect(ctx.requestId).toBe("r2");
      expect(ctx.getEventTrace().length).toBe(0);
    });

    test("removes scoped handlers from the old bus", () => {
      const oldBus = new EventBus();
      const ctx = createTestBaseContext({ bus: oldBus });
      ctx.on("custom:event", () => {});
      expect(oldBus.listenerCount("custom:event")).toBe(1);
      ctx.reset({ bus: new EventBus(), errorHandler: new ErrorHandler() });
      expect(oldBus.listenerCount("custom:event")).toBe(0);
    });

    test("reset without scoped handlers does not throw", () => {
      const ctx = createTestBaseContext();
      ctx.reset({ errorHandler: new ErrorHandler() });
      expect(ctx.scopedHandlers.size).toBe(0);
    });
  });

  describe("markReleased()", () => {
    test("first release returns false, second returns true", () => {
      const ctx = createTestBaseContext();
      expect(ctx.markReleased()).toBe(false);
      expect(ctx.markReleased()).toBe(true);
    });
  });

  // ─── Guards ───────────────────────────────────────────────

  describe("guardDoubleResponse()", () => {
    test("passes when no response was committed", () => {
      const ctx = createTestBaseContext();
      expect(() => ctx.testGuardDoubleResponse()).not.toThrow();
    });

    test("throws when a response was already committed", () => {
      const ctx = createTestBaseContext();
      ctx.testMarkResponded();
      expect(() => ctx.testGuardDoubleResponse()).toThrow(
        "Response already sent. Cannot set body more than once.",
      );
    });
  });
});
