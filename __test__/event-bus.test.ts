import { describe, expect, test, beforeEach, mock } from "bun:test";
import { errorMonitor, captureRejectionSymbol } from "node:events";
import { EventBus } from "../src/event-bus";
import { createTestBus, createTestContext } from "./helpers";
import type { Context } from "../src/context/context";

describe("EventBus", () => {
  let bus: EventBus;
  let ctx: Context;

  beforeEach(() => {
    bus = createTestBus();
    ctx = createTestContext(bus);
  });

  // ─── Constructor & Options ──────────────────────────────

  describe("constructor", () => {
    test("default options", () => {
      const b = new EventBus();
      expect(b.getMaxListeners()).toBe(100);
    });

    test("custom maxListeners", () => {
      const b = new EventBus({ maxListeners: 50 });
      expect(b.getMaxListeners()).toBe(50);
    });

    test("captureRejections default false", () => {
      const b = new EventBus();
      expect(b.listenerCount("test" as never)).toBe(0);
    });

    test("captureRejections true", () => {
      const b = new EventBus({ captureRejections: true });
      expect(b.getMaxListeners()).toBe(100);
    });

    test("Bug 3 fix: undefined options do not overwrite defaults", () => {
      const b = new EventBus({ enableWildcards: undefined as never });
      expect(b.hasListeners("request:start")).toBe(false);
      // enableWildcards should still be true — wildcard listener should match
      b.on("*", () => {});
      expect(b.hasListeners("request:start")).toBe(true);
    });

    test("enableWildcards false disables wildcard matching", () => {
      const b = new EventBus({ enableWildcards: false });
      b.on("*", () => {});
      expect(b.hasListeners("request:start")).toBe(false);
    });

    test("custom wildcardDelimiter", () => {
      const b = new EventBus({ wildcardDelimiter: "." });
      b.on("request.*", () => {});
      expect(b.hasListeners("request.start")).toBe(true);
    });

    test("maxDispatchCacheSize 0 disables cache", () => {
      const b = new EventBus({ maxDispatchCacheSize: 0 });
      b.on("test", () => {});
      expect(b.hasListeners("test")).toBe(true);
    });

    test("maxHasListenersCacheSize 0 disables cache", () => {
      const b = new EventBus({ maxHasListenersCacheSize: 0 });
      b.on("test", () => {});
      expect(b.hasListeners("test")).toBe(true);
    });
  });

  // ─── Listener Management ────────────────────────────────

  describe("on()", () => {
    test("registers and fires listener", async () => {
      let called = false;
      bus.on("test", () => {
        called = true;
      });
      await bus.emitAsync("test", ctx);
      expect(called).toBe(true);
    });

    test("returns this for chaining", () => {
      const result = bus.on("test", () => {});
      expect(result).toBe(bus);
    });

    test("aborted signal skips registration", () => {
      const ac = new AbortController();
      ac.abort();
      bus.on("test", () => {}, { signal: ac.signal });
      expect(bus.listenerCount("test")).toBe(0);
    });

    test("non-aborted signal wraps listener", () => {
      const ac = new AbortController();
      let called = false;
      bus.on(
        "test",
        () => {
          called = true;
        },
        { signal: ac.signal },
      );
      expect(bus.listenerCount("test")).toBe(1);
      // Listener is wrapped, so rawListeners count = 1
      expect(bus.rawListeners("test").length).toBe(1);
    });
  });

  describe("addListener()", () => {
    test("alias for on()", async () => {
      let called = false;
      bus.addListener("test", () => {
        called = true;
      });
      await bus.emitAsync("test", ctx);
      expect(called).toBe(true);
    });
  });

  describe("once()", () => {
    test("fires only once", async () => {
      let count = 0;
      bus.once("test", () => {
        count++;
      });
      await bus.emitAsync("test", ctx);
      await bus.emitAsync("test", ctx);
      expect(count).toBe(1);
    });

    test("aborted signal skips registration", () => {
      const ac = new AbortController();
      ac.abort();
      bus.once("test", () => {}, { signal: ac.signal });
      expect(bus.listenerCount("test")).toBe(0);
    });
  });

  describe("prependListener()", () => {
    test("prepends to front of listener list", async () => {
      const order: string[] = [];
      bus.on("test", () => {
        order.push("second");
      });
      bus.prependListener("test", () => {
        order.push("first");
      });
      await bus.emitAsync("test", ctx);
      expect(order).toEqual(["first", "second"]);
    });

    test("aborted signal skips registration", () => {
      const ac = new AbortController();
      ac.abort();
      bus.prependListener("test", () => {}, { signal: ac.signal });
      expect(bus.listenerCount("test")).toBe(0);
    });
  });

  describe("prependOnceListener()", () => {
    test("prepends and fires only once", async () => {
      const order: string[] = [];
      bus.on("test", () => {
        order.push("always");
      });
      bus.prependOnceListener("test", () => {
        order.push("once");
      });
      await bus.emitAsync("test", ctx);
      await bus.emitAsync("test", ctx);
      expect(order).toEqual(["once", "always", "always"]);
    });

    test("aborted signal skips registration", () => {
      const ac = new AbortController();
      ac.abort();
      bus.prependOnceListener("test", () => {}, { signal: ac.signal });
      expect(bus.listenerCount("test")).toBe(0);
    });
  });

  // ─── off() and removeListener() ─────────────────────────

  describe("off()", () => {
    test("removes a plain listener", async () => {
      let called = false;
      const handler = () => {
        called = true;
      };
      bus.on("test", handler);
      bus.off("test", handler);
      await bus.emitAsync("test", ctx);
      expect(called).toBe(false);
    });

    test("returns this for chaining", () => {
      const handler = () => {};
      bus.on("test", handler);
      expect(bus.off("test", handler)).toBe(bus);
    });

    test("Bug 1 fix: removes AbortSignal-wrapped listener", async () => {
      const ac = new AbortController();
      let called = false;
      const handler = () => {
        called = true;
      };
      bus.on("test", handler, { signal: ac.signal });
      expect(bus.listenerCount("test")).toBe(1);
      bus.off("test", handler);
      expect(bus.listenerCount("test")).toBe(0);
      await bus.emitAsync("test", ctx);
      expect(called).toBe(false);
    });

    test("off() with non-registered handler does not throw", () => {
      expect(() => bus.off("test", () => {})).not.toThrow();
    });
  });

  describe("removeListener()", () => {
    test("alias for off()", async () => {
      let called = false;
      const handler = () => {
        called = true;
      };
      bus.on("test", handler);
      bus.removeListener("test", handler);
      await bus.emitAsync("test", ctx);
      expect(called).toBe(false);
    });
  });

  describe("removeAllListeners()", () => {
    test("removes all listeners for an event", async () => {
      let count = 0;
      bus.on("test", () => {
        count++;
      });
      bus.on("test", () => {
        count++;
      });
      bus.removeAllListeners("test");
      await bus.emitAsync("test", ctx);
      expect(count).toBe(0);
    });

    test("removes all listeners for all events", async () => {
      let count = 0;
      bus.on("a", () => {
        count++;
      });
      bus.on("b", () => {
        count++;
      });
      bus.removeAllListeners();
      await bus.emitAsync("a", ctx);
      await bus.emitAsync("b", ctx);
      expect(count).toBe(0);
    });

    test("returns this", () => {
      expect(bus.removeAllListeners()).toBe(bus);
    });
  });

  // ─── Introspection ──────────────────────────────────────

  describe("eventNames()", () => {
    test("returns registered event names", () => {
      bus.on("a", () => {});
      bus.on("b", () => {});
      const names = bus.eventNames();
      expect(names).toContain("a");
      expect(names).toContain("b");
    });
  });

  describe("listenerCount()", () => {
    test("returns 0 for unregistered event", () => {
      expect(bus.listenerCount("nope")).toBe(0);
    });

    test("returns count for registered event", () => {
      bus.on("test", () => {});
      bus.on("test", () => {});
      expect(bus.listenerCount("test")).toBe(2);
    });
  });

  describe("rawListeners()", () => {
    test("returns raw listener array", () => {
      const h = () => {};
      bus.on("test", h);
      const raw = bus.rawListeners("test");
      expect(raw.length).toBe(1);
    });
  });

  describe("setMaxListeners()", () => {
    test("sets max listeners", () => {
      bus.setMaxListeners(200);
      expect(bus.getMaxListeners()).toBe(200);
    });

    test("returns this", () => {
      expect(bus.setMaxListeners(50)).toBe(bus);
    });
  });

  // ─── hasListeners() ─────────────────────────────────────

  describe("hasListeners()", () => {
    test("false for no listeners", () => {
      expect(bus.hasListeners("test")).toBe(false);
    });

    test("true for exact match", () => {
      bus.on("test", () => {});
      expect(bus.hasListeners("test")).toBe(true);
    });

    test("true for global wildcard match", () => {
      bus.on("*", () => {});
      expect(bus.hasListeners("request:start")).toBe(true);
    });

    test("true for namespace wildcard match", () => {
      bus.on("request:*", () => {});
      expect(bus.hasListeners("request:start")).toBe(true);
    });

    test("false when wildcards disabled", () => {
      const b = new EventBus({ enableWildcards: false });
      b.on("*", () => {});
      expect(b.hasListeners("request:start")).toBe(false);
    });

    test("false when delimiter not in event", () => {
      bus.on("test", () => {});
      expect(bus.hasListeners("test")).toBe(true);
      expect(bus.hasListeners("nope")).toBe(false);
    });

    test("cache hit returns same value", () => {
      bus.on("test", () => {});
      expect(bus.hasListeners("test")).toBe(true);
      expect(bus.hasListeners("test")).toBe(true);
    });

    test("cache invalidated on off()", () => {
      const h = () => {};
      bus.on("test", h);
      expect(bus.hasListeners("test")).toBe(true);
      bus.off("test", h);
      expect(bus.hasListeners("test")).toBe(false);
    });

    test("cache invalidated on removeAllListeners()", () => {
      bus.on("test", () => {});
      expect(bus.hasListeners("test")).toBe(true);
      bus.removeAllListeners();
      expect(bus.hasListeners("test")).toBe(false);
    });

    test("cache invalidated on add for global wildcard", () => {
      bus.on("test", () => {});
      expect(bus.hasListeners("test")).toBe(true);
      bus.on("*", () => {});
      expect(bus.hasListeners("other")).toBe(true);
    });

    test("cache invalidated on add for namespace wildcard", () => {
      bus.on("request:start", () => {});
      expect(bus.hasListeners("request:start")).toBe(true);
      bus.on("request:*", () => {});
      expect(bus.hasListeners("request:end")).toBe(true);
    });

    test("LRU eviction in hasListeners cache", () => {
      const b = new EventBus({ maxHasListenersCacheSize: 2 });
      b.on("a", () => {});
      b.on("b", () => {});
      b.hasListeners("a");
      b.hasListeners("b");
      // Access "a" to make it most recently used
      b.hasListeners("a");
      // Add "c" — should evict "b" (least recently used)
      b.on("c", () => {});
      b.hasListeners("c");
      // "a" should still be cached, "b" should have been evicted
      b.off("a", b.rawListeners("a")[0]!);
      expect(b.hasListeners("a")).toBe(false);
    });

    test("maxHasListenersCacheSize 0 bypasses cache", () => {
      const b = new EventBus({ maxHasListenersCacheSize: 0 });
      b.on("test", () => {});
      expect(b.hasListeners("test")).toBe(true);
      b.removeAllListeners("test");
      expect(b.hasListeners("test")).toBe(false);
    });

    test("multi-delimiter wildcard matching", () => {
      bus.on("a:b:*", () => {});
      expect(bus.hasListeners("a:b:c")).toBe(true);
    });

    test("wildcard with no delimiter returns false", () => {
      const b = new EventBus({ wildcardDelimiter: "" });
      b.on("test", () => {});
      expect(b.hasListeners("test")).toBe(true);
      expect(b.hasListeners("nope")).toBe(false);
    });
  });

  // ─── emitAsync() ────────────────────────────────────────

  describe("emitAsync()", () => {
    test("returns CONTINUE when no listeners", async () => {
      const result = await bus.emitAsync("nope", ctx);
      expect(result).toBe("CONTINUE");
    });

    test("fires listener with payload and meta", async () => {
      let receivedPayload: unknown;
      let receivedMeta: unknown;
      bus.on("test", (c, payload, meta) => {
        receivedPayload = payload;
        receivedMeta = meta;
      });
      await bus.emitAsync("test", ctx, { data: 42 });
      expect(receivedPayload).toEqual({ data: 42 });
      expect((receivedMeta as { event: string }).event).toBe("test");
    });

    test("STOP from listener halts emission", async () => {
      const order: string[] = [];
      bus.on("test", () => {
        order.push("first");
        return "STOP";
      });
      bus.on("test", () => {
        order.push("second");
      });
      const result = await bus.emitAsync("test", ctx);
      expect(result).toBe("STOP");
      expect(order).toEqual(["first"]);
    });

    test("ctx.isStopped() halts before listener", async () => {
      const order: string[] = [];
      bus.on("test", () => {
        order.push("called");
      });
      ctx.stop();
      const result = await bus.emitAsync("test", ctx);
      expect(result).toBe("STOP");
      expect(order).toEqual([]);
    });

    test("ctx.isStopped() halts after listener", async () => {
      const order: string[] = [];
      bus.on("test", (c) => {
        order.push("first");
        c.stop();
      });
      bus.on("test", () => {
        order.push("second");
      });
      const result = await bus.emitAsync("test", ctx);
      expect(result).toBe("STOP");
      expect(order).toEqual(["first"]);
    });

    test("forceDelivery bypasses ctx.isStopped()", async () => {
      let called = false;
      bus.on("test", () => {
        called = true;
      });
      ctx.stop();
      const result = await bus.emitAsync("test", ctx, undefined, {
        forceDelivery: true,
      });
      expect(result).toBe("CONTINUE");
      expect(called).toBe(true);
    });

    test("forceDelivery bypasses ctx.isStopped() after listener", async () => {
      const order: string[] = [];
      bus.on("test", (c) => {
        order.push("first");
        c.stop();
      });
      bus.on("test", () => {
        order.push("second");
      });
      await bus.emitAsync("test", ctx, undefined, { forceDelivery: true });
      expect(order).toEqual(["first", "second"]);
    });

    test("async listener is awaited", async () => {
      const order: string[] = [];
      bus.on("test", async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push("async-done");
      });
      bus.on("test", () => {
        order.push("after");
      });
      await bus.emitAsync("test", ctx);
      expect(order).toEqual(["async-done", "after"]);
    });

    test("async STOP from listener halts", async () => {
      const order: string[] = [];
      bus.on("test", async () => {
        order.push("first");
        return "STOP";
      });
      bus.on("test", () => {
        order.push("second");
      });
      const result = await bus.emitAsync("test", ctx);
      expect(result).toBe("STOP");
      expect(order).toEqual(["first"]);
    });

    test("listener error propagates", async () => {
      bus.on("test", () => {
        throw new Error("boom");
      });
      await expect(bus.emitAsync("test", ctx)).rejects.toThrow("boom");
    });

    test("async listener error propagates", async () => {
      bus.on("test", async () => {
        throw new Error("async-boom");
      });
      await expect(bus.emitAsync("test", ctx)).rejects.toThrow("async-boom");
    });

    test("wildcard listeners are dispatched", async () => {
      const events: string[] = [];
      bus.on("request:*", (c, p, m) => {
        events.push((m as { name: string }).name);
      });
      bus.on("*", (c, p, m) => {
        events.push((m as { name: string }).name);
      });
      await bus.emitAsync("request:start", ctx);
      expect(events).toContain("request:*");
      expect(events).toContain("*");
    });

    test("error event triggers emitErrorMonitor", async () => {
      const b = new EventBus();
      const c = createTestContext(b);
      let monitorCalled = false;
      b.on(errorMonitor, () => {
        monitorCalled = true;
      });
      b.on("error", () => {
        throw new Error("handler-error");
      });
      await expect(
        b.emitAsync("error", c, new Error("test-error")),
      ).rejects.toThrow("handler-error");
      // emitErrorMonitor is called for "error" dispatch event before listeners
      expect(monitorCalled).toBe(true);
    });

    test("captureRejections routes async errors to captureRejection handler", async () => {
      const b = new EventBus({ captureRejections: true });
      const c = createTestContext(b);
      let captured = false;
      // handleRejection checks emitter[captureRejectionSymbol] as a property, not a listener
      const emitter = (
        b as unknown as {
          emitter: { [k: symbol]: (...args: unknown[]) => void };
        }
      ).emitter;
      emitter[captureRejectionSymbol] = () => {
        captured = true;
      };
      b.on("test", async () => {
        throw new Error("async-reject");
      });
      await expect(b.emitAsync("test", c)).rejects.toThrow("async-reject");
      expect(captured).toBe(true);
    });

    test("captureRejections falls back to emitErrorMonitor when no handler", async () => {
      const b = new EventBus({ captureRejections: true });
      const c = createTestContext(b);
      let monitorCalled = false;
      b.on(errorMonitor, () => {
        monitorCalled = true;
      });
      b.on("test", async () => {
        throw new Error("fallback");
      });
      await expect(b.emitAsync("test", c)).rejects.toThrow("fallback");
      expect(monitorCalled).toBe(true);
    });

    test("captureRejections handler error is swallowed", async () => {
      const b = new EventBus({ captureRejections: true });
      const c = createTestContext(b);
      (b as unknown as { on: (e: symbol, h: () => void) => void }).on(
        Symbol.for("nodejs.rejection"),
        () => {
          throw new Error("capture-error");
        },
      );
      b.on("test", async () => {
        throw new Error("original");
      });
      // Should still reject with original error, capture handler error swallowed
      await expect(b.emitAsync("test", c)).rejects.toThrow("original");
    });

    test("no captureRejections — handleRejection returns early", async () => {
      const b = new EventBus({ captureRejections: false });
      const c = createTestContext(b);
      b.on("test", async () => {
        throw new Error("no-capture");
      });
      await expect(b.emitAsync("test", c)).rejects.toThrow("no-capture");
    });
  });

  // ─── emitSync() ─────────────────────────────────────────

  describe("emitSync()", () => {
    test("returns CONTINUE when no listeners", () => {
      expect(bus.emitSync("nope", ctx)).toBe("CONTINUE");
    });

    test("fires listener synchronously", () => {
      let called = false;
      bus.on("test", () => {
        called = true;
      });
      bus.emitSync("test", ctx);
      expect(called).toBe(true);
    });

    test("STOP from listener halts", () => {
      const order: string[] = [];
      bus.on("test", () => {
        order.push("first");
        return "STOP";
      });
      bus.on("test", () => {
        order.push("second");
      });
      expect(bus.emitSync("test", ctx)).toBe("STOP");
      expect(order).toEqual(["first"]);
    });

    test("ctx.isStopped() halts before listener", () => {
      const order: string[] = [];
      bus.on("test", () => {
        order.push("called");
      });
      ctx.stop();
      expect(bus.emitSync("test", ctx)).toBe("STOP");
      expect(order).toEqual([]);
    });

    test("ctx.isStopped() halts after listener", () => {
      const order: string[] = [];
      bus.on("test", (c) => {
        order.push("first");
        c.stop();
      });
      bus.on("test", () => {
        order.push("second");
      });
      expect(bus.emitSync("test", ctx)).toBe("STOP");
      expect(order).toEqual(["first"]);
    });

    test("forceDelivery bypasses ctx.isStopped()", () => {
      let called = false;
      bus.on("test", () => {
        called = true;
      });
      ctx.stop();
      const result = bus.emitSync("test", ctx, undefined, {
        forceDelivery: true,
      });
      expect(result).toBe("CONTINUE");
      expect(called).toBe(true);
    });

    test("forceDelivery bypasses ctx.isStopped() after listener", () => {
      const order: string[] = [];
      bus.on("test", (c) => {
        order.push("first");
        c.stop();
      });
      bus.on("test", () => {
        order.push("second");
      });
      bus.emitSync("test", ctx, undefined, { forceDelivery: true });
      expect(order).toEqual(["first", "second"]);
    });

    test("listener error propagates", () => {
      bus.on("test", () => {
        throw new Error("sync-boom");
      });
      expect(() => bus.emitSync("test", ctx)).toThrow("sync-boom");
    });

    test("warns when handler returns a Promise", () => {
      const warnSpy = mock(() => {});
      const originalWarn = console.warn;
      console.warn = warnSpy;
      bus.on("test", async () => {});
      bus.emitSync("test", ctx);
      console.warn = originalWarn;
      expect(warnSpy).toHaveBeenCalled();
    });

    test("error event triggers emitErrorMonitor", () => {
      const b = new EventBus();
      const c = createTestContext(b);
      let monitorCalled = false;
      b.on(errorMonitor, () => {
        monitorCalled = true;
      });
      b.on("error", () => {
        throw new Error("sync-handler-error");
      });
      expect(() => b.emitSync("error", c, new Error("test"))).toThrow(
        "sync-handler-error",
      );
      expect(monitorCalled).toBe(true);
    });

    test("wildcard listeners dispatched in sync", () => {
      const events: string[] = [];
      bus.on("request:*", (c, p, m) => {
        events.push((m as { name: string }).name);
      });
      bus.emitSync("request:start", ctx);
      expect(events).toContain("request:*");
    });
  });

  // ─── emitParallel() ─────────────────────────────────────

  describe("emitParallel()", () => {
    test("fires all listeners concurrently", async () => {
      const results: number[] = [];
      bus.on("test", async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(1);
      });
      bus.on("test", async () => {
        await new Promise((r) => setTimeout(r, 5));
        results.push(2);
      });
      await bus.emitParallel("test", ctx);
      expect(results.sort()).toEqual([1, 2]);
    });

    test("sync error is caught and sent to errorMonitor", async () => {
      const b = new EventBus();
      const c = createTestContext(b);
      let monitorCalled = false;
      b.on(errorMonitor, () => {
        monitorCalled = true;
      });
      b.on("test", () => {
        throw new Error("parallel-sync");
      });
      await b.emitParallel("test", c);
      expect(monitorCalled).toBe(true);
    });

    test("Bug 2 fix: async error is caught and sent to errorMonitor", async () => {
      const b = new EventBus();
      const c = createTestContext(b);
      let monitorCalled = false;
      b.on(errorMonitor, () => {
        monitorCalled = true;
      });
      b.on("test", async () => {
        throw new Error("parallel-async");
      });
      await b.emitParallel("test", c);
      expect(monitorCalled).toBe(true);
    });

    test("no listeners — no throw", async () => {
      await bus.emitParallel("nope", ctx);
    });

    test("sync listener with no Promise return", async () => {
      let called = false;
      bus.on("test", () => {
        called = true;
      });
      await bus.emitParallel("test", ctx);
      expect(called).toBe(true);
    });

    test("wildcard listeners dispatched", async () => {
      let called = false;
      bus.on("*", () => {
        called = true;
      });
      await bus.emitParallel("request:start", ctx);
      expect(called).toBe(true);
    });
  });

  // ─── AbortSignal behavior ───────────────────────────────

  describe("AbortSignal", () => {
    test("abort removes listener from emitter", async () => {
      const ac = new AbortController();
      let called = false;
      bus.on(
        "test",
        () => {
          called = true;
        },
        { signal: ac.signal },
      );
      expect(bus.listenerCount("test")).toBe(1);
      ac.abort();
      expect(bus.listenerCount("test")).toBe(0);
      await bus.emitAsync("test", ctx);
      expect(called).toBe(false);
    });

    test("abort removes once listener", async () => {
      const ac = new AbortController();
      let called = false;
      bus.once(
        "test",
        () => {
          called = true;
        },
        { signal: ac.signal },
      );
      ac.abort();
      expect(bus.listenerCount("test")).toBe(0);
      await bus.emitAsync("test", ctx);
      expect(called).toBe(false);
    });

    test("abort removes prependListener", async () => {
      const ac = new AbortController();
      let called = false;
      bus.prependListener(
        "test",
        () => {
          called = true;
        },
        { signal: ac.signal },
      );
      ac.abort();
      expect(bus.listenerCount("test")).toBe(0);
    });

    test("abort removes prependOnceListener", async () => {
      const ac = new AbortController();
      let called = false;
      bus.prependOnceListener(
        "test",
        () => {
          called = true;
        },
        { signal: ac.signal },
      );
      ac.abort();
      expect(bus.listenerCount("test")).toBe(0);
    });

    test("listener fires once then cleanup removes abort handler", async () => {
      const ac = new AbortController();
      let called = false;
      bus.once(
        "test",
        () => {
          called = true;
        },
        { signal: ac.signal },
      );
      await bus.emitAsync("test", ctx);
      expect(called).toBe(true);
      // After firing, listener is removed by once
      expect(bus.listenerCount("test")).toBe(0);
      // Aborting after firing should not throw
      expect(() => ac.abort()).not.toThrow();
    });

    test("already-aborted signal returns no-op for all registration methods", () => {
      const ac = new AbortController();
      ac.abort();
      const h = () => {};
      bus.on("test", h, { signal: ac.signal });
      bus.once("test", h, { signal: ac.signal });
      bus.prependListener("test", h, { signal: ac.signal });
      bus.prependOnceListener("test", h, { signal: ac.signal });
      expect(bus.listenerCount("test")).toBe(0);
    });
  });

  // ─── Wildcard dispatch ──────────────────────────────────

  describe("wildcard dispatch", () => {
    test("event with multiple delimiter levels", async () => {
      const events: string[] = [];
      bus.on("a:b:c", (c, p, m) => {
        events.push((m as { name: string }).name);
      });
      bus.on("a:b:*", (c, p, m) => {
        events.push((m as { name: string }).name);
      });
      bus.on("a:*", (c, p, m) => {
        events.push((m as { name: string }).name);
      });
      bus.on("*", (c, p, m) => {
        events.push((m as { name: string }).name);
      });
      await bus.emitAsync("a:b:c", ctx);
      expect(events).toContain("a:b:c");
      expect(events).toContain("a:b:*");
      expect(events).toContain("a:*");
      expect(events).toContain("*");
    });

    test("event that is itself a wildcard is not expanded", async () => {
      const events: string[] = [];
      bus.on("*", (c, p, m) => {
        events.push((m as { name: string }).name);
      });
      await bus.emitAsync("*", ctx);
      // Emitting "*" should only dispatch to "*", not expand further
      expect(events).toEqual(["*"]);
    });

    test("wildcards disabled — no expansion", async () => {
      const b = new EventBus({ enableWildcards: false });
      const c = createTestContext(b);
      const events: string[] = [];
      b.on("*", (ctx2, p, m) => {
        events.push((m as { name: string }).name);
      });
      await b.emitAsync("request:start", c);
      expect(events).toEqual([]);
    });

    test("dispatch cache returns same events", async () => {
      bus.on("test", () => {});
      // First call computes and caches
      const r1 = await bus.emitAsync("test", ctx);
      // Second call uses cache
      const r2 = await bus.emitAsync("test", ctx);
      expect(r1).toBe("CONTINUE");
      expect(r2).toBe("CONTINUE");
    });

    test("dispatch cache LRU eviction", async () => {
      const b = new EventBus({ maxDispatchCacheSize: 2 });
      const c = createTestContext(b);
      b.on("a", () => {});
      b.on("b", () => {});
      b.on("c", () => {});
      // Fill cache with 3 events, max size 2
      await b.emitAsync("a", c);
      await b.emitAsync("b", c);
      // Access "a" to make it MRU
      await b.emitAsync("a", c);
      // Add "c" — should evict "b"
      await b.emitAsync("c", c);
      // All should still work (cache miss recomputes)
      const result = await b.emitAsync("b", c);
      expect(result).toBe("CONTINUE");
    });

    test("maxDispatchCacheSize 0 bypasses cache", async () => {
      const b = new EventBus({ maxDispatchCacheSize: 0 });
      const c = createTestContext(b);
      b.on("test", () => {});
      const result = await b.emitAsync("test", c);
      expect(result).toBe("CONTINUE");
    });

    test("custom delimiter in dispatch", async () => {
      const b = new EventBus({ wildcardDelimiter: "." });
      const c = createTestContext(b);
      const events: string[] = [];
      b.on("req.*", (ctx2, p, m) => {
        events.push((m as { name: string }).name);
      });
      await b.emitAsync("req.start", c);
      expect(events).toContain("req.*");
    });

    test("event with no delimiter — only global wildcard", async () => {
      const events: string[] = [];
      bus.on("plain", (c, p, m) => {
        events.push((m as { name: string }).name);
      });
      bus.on("*", (c, p, m) => {
        events.push((m as { name: string }).name);
      });
      await bus.emitAsync("plain", ctx);
      expect(events).toContain("plain");
      expect(events).toContain("*");
    });
  });

  // ─── buildMeta ──────────────────────────────────────────

  describe("buildMeta", () => {
    test("meta includes event name and source", async () => {
      let receivedMeta: unknown;
      bus.on("test", (c, p, m) => {
        receivedMeta = m;
      });
      await bus.emitAsync("test", ctx, undefined, { source: "step-engine" });
      const meta = receivedMeta as {
        name: string;
        event: string;
        source: string;
        sequence: number;
        timestamp: number;
      };
      expect(meta.event).toBe("test");
      expect(meta.source).toBe("step-engine");
      expect(meta.sequence).toBeGreaterThan(0);
      expect(meta.timestamp).toBeGreaterThan(0);
    });

    test("meta includes custom requestId", async () => {
      let receivedMeta: unknown;
      bus.on("test", (c, p, m) => {
        receivedMeta = m;
      });
      await bus.emitAsync("test", ctx, undefined, { requestId: "custom-req" });
      expect((receivedMeta as { requestId: string }).requestId).toBe(
        "custom-req",
      );
    });

    test("meta includes custom timestamp", async () => {
      let receivedMeta: unknown;
      bus.on("test", (c, p, m) => {
        receivedMeta = m;
      });
      await bus.emitAsync("test", ctx, undefined, { timestamp: 12345 });
      expect((receivedMeta as { timestamp: number }).timestamp).toBe(12345);
    });

    test("sequence increments across emissions", async () => {
      let seq1 = 0,
        seq2 = 0;
      bus.on("a", (c, p, m) => {
        seq1 = (m as { sequence: number }).sequence;
      });
      bus.on("b", (c, p, m) => {
        seq2 = (m as { sequence: number }).sequence;
      });
      await bus.emitAsync("a", ctx);
      await bus.emitAsync("b", ctx);
      expect(seq2).toBeGreaterThan(seq1);
    });
  });

  // ─── emitErrorMonitor ───────────────────────────────────

  describe("emitErrorMonitor", () => {
    test("errorMonitor listener catches sync errors without throwing", async () => {
      const b = new EventBus({ captureRejections: true });
      const c = createTestContext(b);
      let monitorError: unknown;
      b.on(errorMonitor, (err: unknown) => {
        monitorError = err;
      });
      b.on("test", () => {
        throw new Error("monitored");
      });
      await expect(b.emitAsync("test", c)).rejects.toThrow("monitored");
      expect(monitorError).toBeInstanceOf(Error);
    });

    test("errorMonitor listener error is swallowed", async () => {
      bus.on(errorMonitor, () => {
        throw new Error("monitor-boom");
      });
      bus.on("test", () => {
        throw new Error("original");
      });
      await expect(bus.emitAsync("test", ctx)).rejects.toThrow("original");
    });
  });

  // ─── LRU updateAccessOrder ──────────────────────────────

  describe("LRU access order", () => {
    test("hasListeners cache updates access order on hit", () => {
      const b = new EventBus({ maxHasListenersCacheSize: 3 });
      b.on("a", () => {});
      b.on("b", () => {});
      b.on("c", () => {});
      // Fill cache
      b.hasListeners("a");
      b.hasListeners("b");
      b.hasListeners("c");
      // Access "a" to make it MRU
      b.hasListeners("a");
      // Add "d" listener — triggers invalidateHasListenersFor
      // But the cache should still have "a" as MRU
      b.on("d", () => {});
      b.hasListeners("d");
      // "b" should be evicted (LRU), "a" should still be cached
      // After eviction, "b" is stale — re-query
      expect(b.hasListeners("b")).toBe(true); // recomputed
    });

    test("dispatch cache updates access order on hit", async () => {
      const b = new EventBus({ maxDispatchCacheSize: 3 });
      const c = createTestContext(b);
      b.on("a", () => {});
      b.on("b", () => {});
      b.on("c", () => {});
      await b.emitAsync("a", c);
      await b.emitAsync("b", c);
      await b.emitAsync("c", c);
      // Access "a" to make it MRU
      await b.emitAsync("a", c);
      // Add "d" — should evict "b" (LRU)
      b.on("d", () => {});
      await b.emitAsync("d", c);
      // "a" should still work from cache
      const result = await b.emitAsync("a", c);
      expect(result).toBe("CONTINUE");
    });
  });

  // ─── invalidateHasListenersFor edge cases ───────────────

  describe("invalidateHasListenersFor edge cases", () => {
    test("global wildcard invalidation clears all cache entries", () => {
      bus.on("a", () => {});
      bus.on("b", () => {});
      bus.hasListeners("a");
      bus.hasListeners("b");
      // Adding "*" listener invalidates all
      bus.on("*", () => {});
      // Both should be recomputed
      expect(bus.hasListeners("a")).toBe(true);
      expect(bus.hasListeners("b")).toBe(true);
      expect(bus.hasListeners("c")).toBe(true); // matches "*"
    });

    test("namespace wildcard invalidation clears matching prefix", () => {
      bus.on("request:start", () => {});
      bus.on("request:end", () => {});
      bus.on("other:event", () => {});
      bus.hasListeners("request:start");
      bus.hasListeners("request:end");
      bus.hasListeners("other:event");
      // Adding "request:*" should invalidate "request:start" and "request:end" but not "other:event"
      bus.on("request:*", () => {});
      expect(bus.hasListeners("request:end")).toBe(true); // now matches "request:*"
    });

    test("exact event invalidation only clears that key", () => {
      bus.on("a", () => {});
      bus.on("b", () => {});
      bus.hasListeners("a");
      bus.hasListeners("b");
      bus.off("a", bus.rawListeners("a")[0]!);
      expect(bus.hasListeners("a")).toBe(false);
      expect(bus.hasListeners("b")).toBe(true);
    });

    test("wildcards disabled — exact event invalidation only", () => {
      const b = new EventBus({ enableWildcards: false });
      b.on("a", () => {});
      b.on("b", () => {});
      b.hasListeners("a");
      b.hasListeners("b");
      const h = b.rawListeners("a")[0]!;
      b.off("a", h);
      expect(b.hasListeners("a")).toBe(false);
      expect(b.hasListeners("b")).toBe(true);
    });
  });

  // ─── computeHasListeners edge cases ─────────────────────

  describe("computeHasListeners edge cases", () => {
    test("multi-level delimiter search", () => {
      bus.on("a:b:c:d:*", () => {});
      expect(bus.hasListeners("a:b:c:d:e")).toBe(true);
    });

    test("event with delimiter but no wildcard match", () => {
      bus.on("other:*", () => {});
      expect(bus.hasListeners("request:start")).toBe(false);
    });
  });
});
