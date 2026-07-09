import { describe, expect, test, beforeEach } from "bun:test";
import { StepEngine } from "../src/step-engine";
import { EventBus } from "../src/event-bus";
import { Context } from "../src/context/context";
import type { Step, StepResult } from "../src/types";
import {
  createTestBus,
  createTestContext,
  createRecordingStep,
  createResultStep,
  createThrowingStep,
} from "./helpers";

describe("StepEngine", () => {
  let engine: StepEngine;
  let bus: EventBus;
  let ctx: Context;

  beforeEach(() => {
    engine = new StepEngine();
    bus = createTestBus();
    ctx = createTestContext(bus);
  });

  // ─── add() ──────────────────────────────────────────────

  describe("add()", () => {
    test("registers a step", async () => {
      const step: Step = { name: "test", run: () => {} };
      engine.add(step);
      const log: string[] = [];
      engine.add(createRecordingStep("verify", log));
      await engine.run(ctx, bus);
      expect(log).toEqual(["verify"]);
    });

    test("preserves insertion order", async () => {
      const log: string[] = [];
      engine.add(createRecordingStep("a", log));
      engine.add(createRecordingStep("b", log));
      engine.add(createRecordingStep("c", log));
      await engine.run(ctx, bus);
      expect(log).toEqual(["a", "b", "c"]);
    });

    test("throws on duplicate step name", () => {
      engine.add({ name: "dup", run: () => {} });
      expect(() => engine.add({ name: "dup", run: () => {} })).toThrow(
        'StepEngine: Duplicate step name "dup"',
      );
    });
  });

  // ─── prepend() ──────────────────────────────────────────

  describe("prepend()", () => {
    test("inserts step at the front", async () => {
      const log: string[] = [];
      engine.add(createRecordingStep("a", log));
      engine.add(createRecordingStep("b", log));
      engine.prepend(createRecordingStep("first", log));
      await engine.run(ctx, bus);
      expect(log).toEqual(["first", "a", "b"]);
    });

    test("throws on duplicate step name", () => {
      engine.add({ name: "dup", run: () => {} });
      expect(() => engine.prepend({ name: "dup", run: () => {} })).toThrow(
        'StepEngine: Duplicate step name "dup"',
      );
    });
  });

  // ─── run() — basic execution ────────────────────────────

  describe("run()", () => {
    test("no-op when no steps registered", () => {
      const result = engine.run(ctx, bus);
      expect(result).toBeUndefined();
    });

    test("no-op when ctx is already stopped", () => {
      ctx.stop();
      const log: string[] = [];
      engine.add(createRecordingStep("a", log));
      engine.run(ctx, bus);
      expect(log).toEqual([]);
    });

    test("void return continues to next step", async () => {
      const log: string[] = [];
      engine.add(createRecordingStep("a", log, () => {}));
      engine.add(createRecordingStep("b", log, () => {}));
      await engine.run(ctx, bus);
      expect(log).toEqual(["a", "b"]);
    });

    test('"continue" result proceeds to next step', async () => {
      const log: string[] = [];
      const continueResult: StepResult = { type: "continue" };
      engine.add(createRecordingStep("a", log, () => continueResult));
      engine.add(createRecordingStep("b", log));
      await engine.run(ctx, bus);
      expect(log).toEqual(["a", "b"]);
    });

    test("async step is awaited", async () => {
      const log: string[] = [];
      engine.add({
        name: "async-step",
        run: async () => {
          await new Promise((r) => setTimeout(r, 1));
          log.push("async-done");
        },
      });
      engine.add(createRecordingStep("after", log));
      await engine.run(ctx, bus);
      expect(log).toEqual(["async-done", "after"]);
    });
  });

  // ─── run() — stop conditions ────────────────────────────

  describe("run() — stop conditions", () => {
    test('"stop" result halts the pipeline', async () => {
      const log: string[] = [];
      engine.add(
        createRecordingStep("a", log, () => ({ type: "stop" as const })),
      );
      engine.add(createRecordingStep("b", log));
      await engine.run(ctx, bus);
      expect(log).toEqual(["a"]);
      expect(ctx.isStopped()).toBe(true);
    });

    test("ctx.stop() inside a step halts the pipeline", async () => {
      const log: string[] = [];
      engine.add({
        name: "stopper",
        run: (c) => {
          log.push("stopper");
          c.stop();
        },
      });
      engine.add(createRecordingStep("after", log));
      await engine.run(ctx, bus);
      expect(log).toEqual(["stopper"]);
    });

    test('"respond" result halts the pipeline', async () => {
      const log: string[] = [];
      engine.add(
        createRecordingStep("a", log, () => ({ type: "respond" as const })),
      );
      engine.add(createRecordingStep("b", log));
      await engine.run(ctx, bus);
      expect(log).toEqual(["a"]);
    });

    test('"skip" result skips the next step', async () => {
      const log: string[] = [];
      engine.add(
        createRecordingStep("a", log, () => ({ type: "skip" as const })),
      );
      engine.add(createRecordingStep("b", log)); // should be skipped
      engine.add(createRecordingStep("c", log));
      await engine.run(ctx, bus);
      expect(log).toEqual(["a", "c"]);
    });
  });

  // ─── run() — error handling ─────────────────────────────

  describe("run() — error handling", () => {
    test('"error" result throws the error', () => {
      const testError = new Error("step-error");
      engine.add(createResultStep("bad", { type: "error", error: testError }));
      expect(() => engine.run(ctx, bus)).toThrow("step-error");
    });

    test("thrown error in step propagates", () => {
      const testError = new Error("thrown-error");
      engine.add(createThrowingStep("thrower", testError));
      expect(() => engine.run(ctx, bus)).toThrow("thrown-error");
    });

    test("thrown error halts subsequent steps", async () => {
      const log: string[] = [];
      const testError = new Error("halt-error");
      engine.add(createThrowingStep("thrower", testError));
      engine.add(createRecordingStep("after", log));
      await expect(engine.run(ctx, bus)).rejects.toThrow("halt-error");
      expect(log).toEqual([]);
    });

    test("async thrown error propagates", async () => {
      const log: string[] = [];
      const testError = new Error("async-throw");
      engine.add({
        name: "async-thrower",
        run: async () => {
          throw testError;
        },
      });
      engine.add(createRecordingStep("after", log));
      await expect(engine.run(ctx, bus)).rejects.toThrow("async-throw");
    });

    test("emits step:error once when a step throws (general path)", async () => {
      const errorLog: unknown[] = [];
      bus.on("step:error", (c, payload) => {
        errorLog.push(payload);
      });
      bus.on("step:start", () => {}); // force general path
      const testError = new Error("emit-error");
      engine.add(createThrowingStep("thrower", testError));
      await expect(engine.run(ctx, bus)).rejects.toThrow("emit-error");
      expect(errorLog).toHaveLength(1);
      expect((errorLog[0] as { name: string; error: Error }).name).toBe(
        "thrower",
      );
      expect((errorLog[0] as { name: string; error: Error }).error).toBe(
        testError,
      );
    });

    test("emits step:error once when a step returns error result (general path)", async () => {
      const errorLog: unknown[] = [];
      bus.on("step:error", (c, payload) => {
        errorLog.push(payload);
      });
      bus.on("step:start", () => {}); // force general path
      const testError = new Error("result-error");
      engine.add(createResultStep("bad", { type: "error", error: testError }));
      await expect(engine.run(ctx, bus)).rejects.toThrow("result-error");
      // Bug 3 fix: handleResult no longer calls handleStepError;
      // only the catch block in runSteps emits step:error
      expect(errorLog).toHaveLength(1);
    });

    test("fast path: thrown error emits step:error once", () => {
      // Bug 2 fix: step.run() is now inside try/catch on fast path
      let emitCount = 0;
      bus.on("step:error", () => {
        emitCount++;
      });
      const testError = new Error("fast-throw");
      engine.add(createThrowingStep("thrower", testError));
      expect(() => engine.run(ctx, bus)).toThrow("fast-throw");
      expect(emitCount).toBe(1);
    });

    test("fast path: error result emits step:error once", () => {
      // Bug 3 fix: handleResultSync no longer calls handleStepErrorSync;
      // only the catch block emits step:error
      let emitCount = 0;
      bus.on("step:error", () => {
        emitCount++;
      });
      const testError = new Error("fast-result-error");
      engine.add(createResultStep("bad", { type: "error", error: testError }));
      expect(() => engine.run(ctx, bus)).toThrow("fast-result-error");
      expect(emitCount).toBe(1);
    });
  });

  // ─── run() — event lifecycle ────────────────────────────

  describe("run() — event lifecycle", () => {
    test("emits step:start and step:end for each step", async () => {
      const startLog: string[] = [];
      const endLog: string[] = [];

      bus.on("step:start", (c, payload) => {
        startLog.push((payload as { name: string }).name);
      });
      bus.on("step:end", (c, payload) => {
        endLog.push((payload as { name: string }).name);
      });

      engine.add(createRecordingStep("a", []));
      engine.add(createRecordingStep("b", []));
      await engine.run(ctx, bus);

      expect(startLog).toEqual(["a", "b"]);
      expect(endLog).toEqual(["a", "b"]);
    });

    test("step:end includes correct outcome for continue", async () => {
      const outcomes: string[] = [];
      bus.on("step:end", (c, payload) => {
        outcomes.push((payload as { outcome: string }).outcome);
      });
      engine.add(createRecordingStep("a", []));
      await engine.run(ctx, bus);
      expect(outcomes).toEqual(["continue"]);
    });

    test("step:end IS delivered with 'stopped' outcome when ctx.stop() is called (general path)", async () => {
      // Bug 4 fix: step:end now uses forceDelivery: true
      const outcomes: string[] = [];
      bus.on("step:end", (c, payload) => {
        outcomes.push((payload as { outcome: string }).outcome);
      });
      engine.add(createResultStep("a", { type: "stop" }));
      engine.add(createRecordingStep("b", []));
      await engine.run(ctx, bus);
      expect(outcomes).toEqual(["stopped"]);
    });

    test("step:end includes correct outcome for skip", async () => {
      const outcomes: string[] = [];
      bus.on("step:end", (c, payload) => {
        outcomes.push((payload as { outcome: string }).outcome);
      });
      engine.add(createResultStep("a", { type: "skip" }));
      engine.add(createRecordingStep("b", []));
      await engine.run(ctx, bus);
      expect(outcomes).toEqual(["skipped"]);
    });

    test("step:end includes correct outcome for respond", async () => {
      const outcomes: string[] = [];
      bus.on("step:end", (c, payload) => {
        outcomes.push((payload as { outcome: string }).outcome);
      });
      engine.add(createResultStep("a", { type: "respond" }));
      await engine.run(ctx, bus);
      expect(outcomes).toEqual(["responded_early"]);
    });

    test("step:start STOP signal halts before step runs", async () => {
      const log: string[] = [];
      bus.on("step:start", (c, payload) => {
        if ((payload as { name: string }).name === "a") return "STOP" as const;
      });
      engine.add(createRecordingStep("a", log));
      engine.add(createRecordingStep("b", log));
      await engine.run(ctx, bus);
      expect(log).toEqual([]);
    });

    test("step:start ctx.stop() halts before step runs", async () => {
      const log: string[] = [];
      bus.on("step:start", (c) => {
        c.stop();
      });
      engine.add(createRecordingStep("a", log));
      await engine.run(ctx, bus);
      expect(log).toEqual([]);
    });

    test("step:end IS delivered with 'responded' outcome when ctx.hasResponded() (general path)", async () => {
      // Bug 4 fix: step:end now uses forceDelivery: true
      const outcomes: string[] = [];
      bus.on("step:end", (c, payload) => {
        outcomes.push((payload as { outcome: string }).outcome);
      });
      engine.add({
        name: "responder",
        run: (c) => {
          c.json({ ok: true });
        },
      });
      engine.add(createRecordingStep("b", []));
      await engine.run(ctx, bus);
      expect(outcomes).toEqual(["responded"]);
    });

    test("ctx.fail() throws and halts pipeline (general path)", async () => {
      const testError = new Error("fail-error");
      bus.on("step:start", () => {}); // force general path
      engine.add({
        name: "failer",
        run: (c) => {
          c.fail(testError);
        },
      });
      engine.add(createRecordingStep("after", []));
      await expect(engine.run(ctx, bus)).rejects.toThrow("fail-error");
    });
  });

  // ─── run() — fast path (single step, no step:start listeners) ──

  describe("run() — fast path", () => {
    test("single sync step with no event listeners runs synchronously", () => {
      const log: string[] = [];
      engine.add(createRecordingStep("solo", log));
      const result = engine.run(ctx, bus);
      expect(result).toBeUndefined();
      expect(log).toEqual(["solo"]);
    });

    test("single async step executes step.run() only once", async () => {
      // Bug 1 fix: async step on fast path no longer falls through to runSteps
      const log: string[] = [];
      engine.add({
        name: "async-solo",
        run: async () => {
          await new Promise((r) => setTimeout(r, 1));
          log.push("done");
        },
      });
      const result = engine.run(ctx, bus);
      expect(result).toBeInstanceOf(Promise);
      await result;
      expect(log).toEqual(["done"]);
    });

    test("single async step error emits step:error once", async () => {
      // Bug 1+2+3 fix: async step handled inline, error caught and emitted once
      let emitCount = 0;
      bus.on("step:error", () => {
        emitCount++;
      });
      const testError = new Error("async-fast-error");
      engine.add({
        name: "async-thrower",
        run: async () => {
          throw testError;
        },
      });
      await expect(engine.run(ctx, bus)).rejects.toThrow("async-fast-error");
      expect(emitCount).toBe(1);
    });

    test("single async step error result emits step:error once", async () => {
      let emitCount = 0;
      bus.on("step:error", () => {
        emitCount++;
      });
      const testError = new Error("async-result-error");
      engine.add({
        name: "async-bad",
        run: async () => ({ type: "error" as const, error: testError }),
      });
      await expect(engine.run(ctx, bus)).rejects.toThrow("async-result-error");
      expect(emitCount).toBe(1);
    });

    test("single sync step with step:start listeners uses general path", async () => {
      const startLog: string[] = [];
      bus.on("step:start", (c, payload) => {
        startLog.push((payload as { name: string }).name);
      });
      engine.add(createRecordingStep("solo", []));
      const result = engine.run(ctx, bus);
      expect(result).toBeInstanceOf(Promise);
      await result;
      expect(startLog).toEqual(["solo"]);
    });

    test("single sync step returning stop on fast path", () => {
      engine.add(createResultStep("solo", { type: "stop" }));
      engine.run(ctx, bus);
      expect(ctx.isStopped()).toBe(true);
    });

    test("single sync step returning error on fast path throws", () => {
      const testError = new Error("fast-error");
      engine.add(createResultStep("solo", { type: "error", error: testError }));
      expect(() => engine.run(ctx, bus)).toThrow("fast-error");
    });

    test("skip result on general path skips next step", async () => {
      const log: string[] = [];
      engine.add(
        createRecordingStep("solo", log, () => ({ type: "skip" as const })),
      );
      engine.add(createRecordingStep("after", log));
      await engine.run(ctx, bus);
      expect(log).toEqual(["solo"]);
    });

    test("single sync step returning respond on fast path", () => {
      const log: string[] = [];
      engine.add(createResultStep("solo", { type: "respond" }));
      engine.add(createRecordingStep("after", log));
      engine.run(ctx, bus);
      // respond result sets outcome "responded_early" which halts pipeline
      expect(log).toEqual([]);
    });

    test("single sync step with step:end listener on fast path", () => {
      const outcomes: string[] = [];
      bus.on("step:end", (c, payload) => {
        outcomes.push((payload as { outcome: string }).outcome);
      });
      engine.add(createRecordingStep("solo", []));
      engine.run(ctx, bus);
      expect(outcomes).toEqual(["continue"]);
    });

    test("fast path: ctx.fail() throws synchronously", () => {
      const testError = new Error("fast-fail");
      engine.add({
        name: "failer",
        run: (c) => {
          c.fail(testError);
        },
      });
      expect(() => engine.run(ctx, bus)).toThrow("fast-fail");
    });

    test("fast path: ctx.hasResponded() outcome", () => {
      engine.add({
        name: "responder",
        run: (c) => {
          c.json({ ok: true });
        },
      });
      engine.run(ctx, bus);
      expect(ctx.hasResponded()).toBe(true);
    });

    test("fast path: ctx.isStopped() outcome", () => {
      engine.add({
        name: "stopper",
        run: (c) => {
          c.stop();
        },
      });
      engine.run(ctx, bus);
      expect(ctx.isStopped()).toBe(true);
    });

    test("fast path: ctx.isRespondEarly() outcome", () => {
      engine.add({
        name: "early-responder",
        run: (c) => {
          c.respond();
        },
      });
      engine.run(ctx, bus);
      expect(ctx.isRespondEarly()).toBe(true);
    });

    test("fast path: ctx.isSkipped() outcome", () => {
      engine.add({
        name: "skipper",
        run: (c) => {
          c.skip();
        },
      });
      engine.run(ctx, bus);
      expect(ctx.isSkipped()).toBe(true);
    });

    test("fast path: step:end IS delivered when ctx.stop() called (forceDelivery)", () => {
      // Bug 4 fix: step:end uses forceDelivery: true
      const outcomes: string[] = [];
      bus.on("step:end", (c, payload) => {
        outcomes.push((payload as { outcome: string }).outcome);
      });
      engine.add({
        name: "stopper",
        run: (c) => {
          c.stop();
        },
      });
      engine.run(ctx, bus);
      expect(outcomes).toEqual(["stopped"]);
    });

    test("fast path: step:end IS delivered when ctx.hasResponded() (forceDelivery)", () => {
      // Bug 4 fix: step:end uses forceDelivery: true
      const outcomes: string[] = [];
      bus.on("step:end", (c, payload) => {
        outcomes.push((payload as { outcome: string }).outcome);
      });
      engine.add({
        name: "responder",
        run: (c) => {
          c.json({ ok: true });
        },
      });
      engine.run(ctx, bus);
      expect(outcomes).toEqual(["responded"]);
    });

    test("fast path: step:end delivered for ctx.isRespondEarly()", () => {
      const outcomes: string[] = [];
      bus.on("step:end", (c, payload) => {
        outcomes.push((payload as { outcome: string }).outcome);
      });
      engine.add({
        name: "early",
        run: (c) => {
          c.respond();
        },
      });
      engine.run(ctx, bus);
      expect(outcomes).toEqual(["responded_early"]);
    });

    test("fast path: step:end delivered for ctx.isSkipped()", () => {
      const outcomes: string[] = [];
      bus.on("step:end", (c, payload) => {
        outcomes.push((payload as { outcome: string }).outcome);
      });
      engine.add({
        name: "skipper",
        run: (c) => {
          c.skip();
        },
      });
      engine.run(ctx, bus);
      expect(outcomes).toEqual(["skipped"]);
    });
  });

  // ─── handleResult coverage (general path) ───────────────

  describe("handleResult — ctx state checks (general path)", () => {
    test("ctx.isStopped() in continue outcome (general path)", async () => {
      const outcomes: string[] = [];
      bus.on("step:end", (c, payload) => {
        outcomes.push((payload as { outcome: string }).outcome);
      });
      engine.add({
        name: "stopper",
        run: (c) => {
          c.stop();
        },
      });
      engine.add(createRecordingStep("after", []));
      await engine.run(ctx, bus);
      // Bug 4 fix: step:end IS delivered with forceDelivery
      expect(outcomes).toEqual(["stopped"]);
    });

    test("ctx.isRespondEarly() in continue outcome (general path)", async () => {
      const outcomes: string[] = [];
      bus.on("step:end", (c, payload) => {
        outcomes.push((payload as { outcome: string }).outcome);
      });
      engine.add({
        name: "early",
        run: (c) => {
          c.respond();
        },
      });
      engine.add(createRecordingStep("after", []));
      await engine.run(ctx, bus);
      expect(outcomes).toEqual(["responded_early"]);
    });

    test("ctx.isSkipped() in continue outcome (general path)", async () => {
      const outcomes: string[] = [];
      bus.on("step:end", (c, payload) => {
        outcomes.push((payload as { outcome: string }).outcome);
      });
      engine.add({
        name: "skipper",
        run: (c) => {
          c.skip();
        },
      });
      engine.add(createRecordingStep("after", []));
      await engine.run(ctx, bus);
      expect(outcomes).toEqual(["skipped"]);
    });

    test("ctx.hasResponded() in continue outcome (general path)", async () => {
      const outcomes: string[] = [];
      bus.on("step:end", (c, payload) => {
        outcomes.push((payload as { outcome: string }).outcome);
      });
      engine.add({
        name: "responder",
        run: (c) => {
          c.json({ ok: true });
        },
      });
      engine.add(createRecordingStep("after", []));
      await engine.run(ctx, bus);
      // Bug 4 fix: step:end IS delivered with forceDelivery
      expect(outcomes).toEqual(["responded"]);
    });

    test("ctx.fail() in continue outcome (general path)", async () => {
      const testError = new Error("ctx-fail");
      engine.add({
        name: "failer",
        run: (c) => {
          c.fail(testError);
        },
      });
      engine.add(createRecordingStep("after", []));
      await expect(engine.run(ctx, bus)).rejects.toThrow("ctx-fail");
    });

    test("step:end not emitted when no listeners (general path)", async () => {
      engine.add(createRecordingStep("a", []));
      await engine.run(ctx, bus);
    });

    test("step:error not emitted when no listeners (general path)", async () => {
      bus.on("step:start", () => {}); // force general path
      engine.add(createThrowingStep("thrower", new Error("no-listener")));
      await expect(engine.run(ctx, bus)).rejects.toThrow("no-listener");
    });
  });

  // ─── handleStepErrorSync without listeners (fast path) ──

  describe("handleStepErrorSync — no listeners", () => {
    test("fast path error result with no step:error listener", () => {
      engine.add(
        createResultStep("bad", { type: "error", error: new Error("silent") }),
      );
      expect(() => engine.run(ctx, bus)).toThrow("silent");
    });
  });
});
