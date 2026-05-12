/**
 * SinwanJS Reactivity Core — Unit Tests
 *
 * Tests: signal, computed, effect, batch, scheduler (nextTick).
 * Run with: bun test src/client/reactivity/__tests__/reactivity.test.ts
 */

import { describe, it, expect } from "bun:test";
import { signal, isSignal } from "../signal.ts";
import { computed, isComputed } from "../computed.ts";
import { effect } from "../effect.ts";
import { batch } from "../batch.ts";
import { nextTick } from "../scheduler.ts";

// ─── Signal ────────────────────────────────────────────────

describe("signal", () => {
  it("holds an initial value", () => {
    const s = signal(42);
    expect(s.value).toBe(42);
  });

  it("updates on write", () => {
    const s = signal("hello");
    s.value = "world";
    expect(s.value).toBe("world");
  });

  it("peek() reads without tracking", () => {
    const s = signal(10);
    let tracked = false;

    effect(() => {
      // Use peek — should NOT re-run when s changes
      s.peek();
      tracked = true;
    });

    tracked = false;
    s.value = 20;

    // Wait for microtask flush
    return nextTick().then(() => {
      expect(tracked).toBe(false);
    });
  });

  it("skips update if value is the same (Object.is)", () => {
    const s = signal(5);
    let runCount = 0;

    effect(() => {
      void s.value;
      runCount++;
    });

    expect(runCount).toBe(1); // initial run

    s.value = 5; // same value — no trigger
    return nextTick().then(() => {
      expect(runCount).toBe(1);
    });
  });

  it("isSignal() type guard works", () => {
    const s = signal(0);
    expect(isSignal(s)).toBe(true);
    expect(isSignal(42)).toBe(false);
    expect(isSignal(null)).toBe(false);
    expect(isSignal({ value: 1 })).toBe(false);
  });

  it("subscribe() for manual callbacks", () => {
    const s = signal(0);
    const values: number[] = [];

    const unsub = s.subscribe((v) => values.push(v));
    s.value = 1;
    s.value = 2;

    expect(values).toEqual([1, 2]);

    unsub();
    s.value = 3;
    expect(values).toEqual([1, 2]); // no more notifications
  });

  it("toString() returns string representation", () => {
    const s = signal(123);
    expect(`${s}`).toBe("123");
  });
});

// ─── Effect ────────────────────────────────────────────────

describe("effect", () => {
  it("runs immediately on creation", () => {
    let ran = false;
    effect(() => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("re-runs when a tracked signal changes", async () => {
    const count = signal(0);
    const log: number[] = [];

    effect(() => {
      log.push(count.value);
    });

    expect(log).toEqual([0]);

    count.value = 1;
    await nextTick();
    expect(log).toEqual([0, 1]);

    count.value = 2;
    await nextTick();
    expect(log).toEqual([0, 1, 2]);
  });

  it("tracks multiple signals", async () => {
    const a = signal(1);
    const b = signal(2);
    const log: number[] = [];

    effect(() => {
      log.push(a.value + b.value);
    });

    expect(log).toEqual([3]);

    a.value = 10;
    await nextTick();
    expect(log).toEqual([3, 12]);

    b.value = 20;
    await nextTick();
    expect(log).toEqual([3, 12, 30]);
  });

  it("stops tracking after dispose", async () => {
    const s = signal(0);
    let runCount = 0;

    const dispose = effect(() => {
      void s.value;
      runCount++;
    });

    expect(runCount).toBe(1);

    dispose();
    s.value = 1;
    await nextTick();
    expect(runCount).toBe(1); // did not re-run
  });

  it("runs cleanup function on re-run", async () => {
    const s = signal(0);
    let cleanedUp = false;

    effect(() => {
      void s.value;
      return () => {
        cleanedUp = true;
      };
    });

    expect(cleanedUp).toBe(false);

    s.value = 1;
    await nextTick();
    expect(cleanedUp).toBe(true);
  });

  it("runs cleanup on dispose", () => {
    let cleanedUp = false;

    const dispose = effect(() => {
      return () => {
        cleanedUp = true;
      };
    });

    expect(cleanedUp).toBe(false);
    dispose();
    expect(cleanedUp).toBe(true);
  });

  it("handles dynamic dependencies (conditional branches)", async () => {
    const toggle = signal(true);
    const a = signal("A");
    const b = signal("B");
    const log: string[] = [];

    effect(() => {
      if (toggle.value) {
        log.push(a.value);
      } else {
        log.push(b.value);
      }
    });

    expect(log).toEqual(["A"]);

    // Changing b should NOT trigger (not tracked in current branch)
    b.value = "B2";
    await nextTick();
    expect(log).toEqual(["A"]);

    // Switch branch
    toggle.value = false;
    await nextTick();
    expect(log).toEqual(["A", "B2"]);

    // Now a should NOT trigger
    a.value = "A2";
    await nextTick();
    expect(log).toEqual(["A", "B2"]);

    // b should trigger
    b.value = "B3";
    await nextTick();
    expect(log).toEqual(["A", "B2", "B3"]);
  });
});

// ─── Computed ──────────────────────────────────────────────

describe("computed", () => {
  it("derives from a signal", () => {
    const count = signal(3);
    const doubled = computed(() => count.value * 2);

    expect(doubled.value).toBe(6);
  });

  it("updates when dependency changes", async () => {
    const count = signal(2);
    const doubled = computed(() => count.value * 2);

    expect(doubled.value).toBe(4);

    count.value = 5;
    await nextTick();
    expect(doubled.value).toBe(10);
  });

  it("chains with other computed values", async () => {
    const a = signal(1);
    const b = computed(() => a.value * 2);
    const c = computed(() => b.value + 10);

    expect(c.value).toBe(12);

    a.value = 5;
    await nextTick();
    expect(b.value).toBe(10);
    expect(c.value).toBe(20);
  });

  it("is trackable by effects", async () => {
    const count = signal(0);
    const doubled = computed(() => count.value * 2);
    const log: number[] = [];

    effect(() => {
      log.push(doubled.value);
    });

    expect(log).toEqual([0]);

    count.value = 3;
    await nextTick();
    expect(log).toEqual([0, 6]);
  });

  it("isComputed() type guard works", () => {
    const c = computed(() => 42);
    expect(isComputed(c)).toBe(true);
    expect(isComputed(signal(0))).toBe(false);
    expect(isComputed(null)).toBe(false);
  });

  it("peek() reads without tracking", () => {
    const count = signal(5);
    const doubled = computed(() => count.value * 2);

    expect(doubled.peek()).toBe(10);
  });
});

// ─── Batch ─────────────────────────────────────────────────

describe("batch", () => {
  it("coalesces multiple signal writes into one effect run", async () => {
    const a = signal(1);
    const b = signal(2);
    let runCount = 0;

    effect(() => {
      void a.value;
      void b.value;
      runCount++;
    });

    expect(runCount).toBe(1);

    batch(() => {
      a.value = 10;
      b.value = 20;
    });

    // batch flushes synchronously at the end
    expect(runCount).toBe(2); // only ran once more
  });

  it("supports nested batches", async () => {
    const s = signal(0);
    let runCount = 0;

    effect(() => {
      void s.value;
      runCount++;
    });

    expect(runCount).toBe(1);

    batch(() => {
      s.value = 1;
      batch(() => {
        s.value = 2;
      });
      s.value = 3;
    });

    expect(runCount).toBe(2); // only one extra flush at outer batch end
  });
});

// ─── nextTick ──────────────────────────────────────────────

describe("nextTick", () => {
  it("resolves after pending effects", async () => {
    const s = signal(0);
    let effectRan = false;

    effect(() => {
      if (s.value > 0) effectRan = true;
    });

    s.value = 1;
    expect(effectRan).toBe(false); // not yet — microtask pending

    await nextTick();
    expect(effectRan).toBe(true);
  });

  it("accepts a callback", async () => {
    let called = false;
    await nextTick(() => {
      called = true;
    });
    expect(called).toBe(true);
  });
});

// ─── Integration ───────────────────────────────────────────

describe("integration", () => {
  it("full counter scenario", async () => {
    const count = signal(0);
    const doubled = computed(() => count.value * 2);
    const log: string[] = [];

    effect(() => {
      log.push(`count=${count.value}, doubled=${doubled.value}`);
    });

    expect(log).toEqual(["count=0, doubled=0"]);

    count.value++;
    await nextTick();
    expect(log).toEqual(["count=0, doubled=0", "count=1, doubled=2"]);

    batch(() => {
      count.value = 10;
      count.value = 20;
    });

    expect(log).toEqual([
      "count=0, doubled=0",
      "count=1, doubled=2",
      "count=20, doubled=40",
    ]);
  });
});
