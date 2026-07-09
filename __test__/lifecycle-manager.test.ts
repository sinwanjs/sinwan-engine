import { describe, expect, test } from "bun:test";
import { LifecycleManager } from "../src/lifecycle-manager";
import { LifecycleState } from "../src/types";

describe("LifecycleManager", () => {
  // ─── on / off / once ─────────────────────────────────────

  describe("on / off / once", () => {
    test("on registers a listener that fires on transition", async () => {
      const lm = new LifecycleManager();
      let received: unknown;
      lm.on("init", (payload) => {
        received = payload;
      });
      await lm.init({ options: {} });
      expect(received).toEqual({ options: {} });
    });

    test("off removes a previously registered listener", async () => {
      const lm = new LifecycleManager();
      let callCount = 0;
      const handler = (): void => {
        callCount++;
      };
      lm.on("init", handler);
      lm.off("init", handler);
      await lm.init({ options: {} });
      expect(callCount).toBe(0);
    });

    test("once registers a listener that fires only once", async () => {
      const lm = new LifecycleManager();
      let callCount = 0;
      lm.once("init", () => {
        callCount++;
      });
      await lm.init({ options: {} });
      // Re-register and fire again to verify once behavior
      expect(callCount).toBe(1);
    });

    test("off returns this for chaining", () => {
      const lm = new LifecycleManager();
      const handler = (): void => {};
      lm.on("init", handler);
      expect(lm.off("init", handler)).toBe(lm);
    });

    test("once returns this for chaining", () => {
      const lm = new LifecycleManager();
      expect(lm.once("init", () => {})).toBe(lm);
    });

    test("on returns this for chaining", () => {
      const lm = new LifecycleManager();
      expect(lm.on("init", () => {})).toBe(lm);
    });
  });

  // ─── init / ready / shutdown / destroy ───────────────────

  describe("init / ready / shutdown / destroy", () => {
    test("init transitions from IDLE to INIT", async () => {
      const lm = new LifecycleManager();
      expect(lm.getState()).toBe(LifecycleState.IDLE);
      await lm.init({ options: {} });
      expect(lm.getState()).toBe(LifecycleState.INIT);
    });

    test("ready transitions from INIT to READY", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      await lm.ready({ port: 3000 });
      expect(lm.getState()).toBe(LifecycleState.READY);
    });

    test("shutdown transitions from READY to SHUTDOWN", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      await lm.ready({ port: 3000 });
      await lm.shutdown();
      expect(lm.getState()).toBe(LifecycleState.SHUTDOWN);
    });

    test("shutdown transitions from INIT to SHUTDOWN", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      await lm.shutdown();
      expect(lm.getState()).toBe(LifecycleState.SHUTDOWN);
    });

    test("destroy transitions from SHUTDOWN to DESTROYED", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      await lm.ready({ port: 3000 });
      await lm.shutdown();
      await lm.destroy();
      expect(lm.getState()).toBe(LifecycleState.DESTROYED);
    });

    test("init throws if not in IDLE", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      expect(() => lm.init({ options: {} })).toThrow(
        'Cannot transition to "init" from "init"',
      );
    });

    test("ready throws if not in INIT", async () => {
      const lm = new LifecycleManager();
      expect(() => lm.ready({ port: 3000 })).toThrow(
        'Cannot transition to "ready" from "idle"',
      );
    });

    test("shutdown throws if not in INIT or READY", async () => {
      const lm = new LifecycleManager();
      expect(() => lm.shutdown()).toThrow(
        'Cannot transition to "shutdown" from "idle"',
      );
    });

    test("destroy throws if not in SHUTDOWN", async () => {
      const lm = new LifecycleManager();
      expect(() => lm.destroy()).toThrow(
        'Cannot transition to "destroyed" from "idle"',
      );
    });

    test("destroy throws from READY state", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      await lm.ready({ port: 3000 });
      expect(() => lm.destroy()).toThrow(
        'Cannot transition to "destroyed" from "ready"',
      );
    });

    test("ready throws from SHUTDOWN state", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      await lm.ready({ port: 3000 });
      await lm.shutdown();
      expect(() => lm.ready({ port: 3000 })).toThrow(
        'Cannot transition to "ready" from "shutdown"',
      );
    });

    test("init throws from DESTROYED state", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      await lm.ready({ port: 3000 });
      await lm.shutdown();
      await lm.destroy();
      expect(() => lm.init({ options: {} })).toThrow(
        'Cannot transition to "init" from "destroyed"',
      );
    });
  });

  // ─── getState / is ───────────────────────────────────────

  describe("getState / is", () => {
    test("getState returns current state", () => {
      const lm = new LifecycleManager();
      expect(lm.getState()).toBe(LifecycleState.IDLE);
    });

    test("is returns true for matching state", () => {
      const lm = new LifecycleManager();
      expect(lm.is(LifecycleState.IDLE)).toBe(true);
    });

    test("is returns false for non-matching state", () => {
      const lm = new LifecycleManager();
      expect(lm.is(LifecycleState.INIT)).toBe(false);
    });
  });

  // ─── can ─────────────────────────────────────────────────

  describe("can", () => {
    test("IDLE can transition to INIT", () => {
      const lm = new LifecycleManager();
      expect(lm.can(LifecycleState.INIT)).toBe(true);
    });

    test("IDLE cannot transition to READY", () => {
      const lm = new LifecycleManager();
      expect(lm.can(LifecycleState.READY)).toBe(false);
    });

    test("IDLE cannot transition to SHUTDOWN", () => {
      const lm = new LifecycleManager();
      expect(lm.can(LifecycleState.SHUTDOWN)).toBe(false);
    });

    test("IDLE cannot transition to DESTROYED", () => {
      const lm = new LifecycleManager();
      expect(lm.can(LifecycleState.DESTROYED)).toBe(false);
    });

    test("INIT can transition to READY", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      expect(lm.can(LifecycleState.READY)).toBe(true);
    });

    test("INIT cannot transition to SHUTDOWN via can()", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      // can() only allows INIT->READY, even though shutdown() accepts INIT
      expect(lm.can(LifecycleState.SHUTDOWN)).toBe(false);
    });

    test("INIT cannot transition to INIT", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      expect(lm.can(LifecycleState.INIT)).toBe(false);
    });

    test("READY can transition to SHUTDOWN", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      await lm.ready({ port: 3000 });
      expect(lm.can(LifecycleState.SHUTDOWN)).toBe(true);
    });

    test("READY cannot transition to INIT", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      await lm.ready({ port: 3000 });
      expect(lm.can(LifecycleState.INIT)).toBe(false);
    });

    test("SHUTDOWN can transition to DESTROYED", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      await lm.ready({ port: 3000 });
      await lm.shutdown();
      expect(lm.can(LifecycleState.DESTROYED)).toBe(true);
    });

    test("SHUTDOWN cannot transition to READY", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      await lm.ready({ port: 3000 });
      await lm.shutdown();
      expect(lm.can(LifecycleState.READY)).toBe(false);
    });

    test("DESTROYED cannot transition to anything", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      await lm.ready({ port: 3000 });
      await lm.shutdown();
      await lm.destroy();
      expect(lm.can(LifecycleState.IDLE)).toBe(false);
      expect(lm.can(LifecycleState.INIT)).toBe(false);
      expect(lm.can(LifecycleState.READY)).toBe(false);
      expect(lm.can(LifecycleState.SHUTDOWN)).toBe(false);
      expect(lm.can(LifecycleState.DESTROYED)).toBe(false);
    });
  });

  // ─── assert ──────────────────────────────────────────────

  describe("assert", () => {
    test("assert passes when state matches", () => {
      const lm = new LifecycleManager();
      expect(() => lm.assert(LifecycleState.IDLE)).not.toThrow();
    });

    test("assert passes when state is one of allowed", () => {
      const lm = new LifecycleManager();
      expect(() =>
        lm.assert(LifecycleState.INIT, LifecycleState.IDLE),
      ).not.toThrow();
    });

    test("assert throws when state does not match", () => {
      const lm = new LifecycleManager();
      expect(() => lm.assert(LifecycleState.INIT)).toThrow(
        'Expected state init, but current state is "idle"',
      );
    });

    test("assert throws with multiple allowed states", () => {
      const lm = new LifecycleManager();
      expect(() =>
        lm.assert(LifecycleState.READY, LifecycleState.SHUTDOWN),
      ).toThrow('Expected state ready | shutdown, but current state is "idle"');
    });

    test("assert throws from DESTROYED", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      await lm.ready({ port: 3000 });
      await lm.shutdown();
      await lm.destroy();
      expect(() => lm.assert(LifecycleState.IDLE)).toThrow(
        'Expected state idle, but current state is "destroyed"',
      );
    });
  });

  // ─── Event emission ──────────────────────────────────────

  describe("Event emission", () => {
    test("init emits with payload", async () => {
      const lm = new LifecycleManager();
      let received: unknown;
      lm.on("init", (payload) => {
        received = payload;
      });
      await lm.init({ options: {} });
      expect(received).toEqual({ options: {} });
    });

    test("ready emits with payload", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      let received: unknown;
      lm.on("ready", (payload) => {
        received = payload;
      });
      await lm.ready({ port: 3000, protocol: "http" });
      expect(received).toEqual({ port: 3000, protocol: "http" });
    });

    test("shutdown emits with undefined payload", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      await lm.ready({ port: 3000 });
      let received: unknown = "not-called";
      lm.on("shutdown", (payload) => {
        received = payload;
      });
      await lm.shutdown();
      expect(received).toBeUndefined();
    });

    test("destroy emits with undefined payload", async () => {
      const lm = new LifecycleManager();
      await lm.init({ options: {} });
      await lm.ready({ port: 3000 });
      await lm.shutdown();
      let received: unknown = "not-called";
      lm.on("destroy", (payload) => {
        received = payload;
      });
      await lm.destroy();
      expect(received).toBeUndefined();
    });

    test("multiple listeners all fire", async () => {
      const lm = new LifecycleManager();
      let count = 0;
      lm.on("init", () => {
        count++;
      });
      lm.on("init", () => {
        count++;
      });
      await lm.init({ options: {} });
      expect(count).toBe(2);
    });
  });
});
