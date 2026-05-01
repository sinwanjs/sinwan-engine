/**
 * SinwanJS Core Runtime — v2 Example Usage
 *
 * Demonstrates:
 *  1. Dependency Injection (DI)
 *  2. Router Plugin (with URL params)
 *  3. Built-in Body Parsing
 *  4. Streaming Responses
 *
 * Run with: bun run src/example.ts
 */

import { StepEngine } from "../step-engine";
import { EventBus } from "../event-bus";
import { ErrorHandler } from "../error-handler";
import { Runtime } from "../runtime";
import { Router } from "../router";
import type { Step } from "../types";

// ─── 1. Setup Core App ─────────────────────────────────────

const engine = new StepEngine();
const bus = new EventBus();
const errorHandler = new ErrorHandler({
    onError: (err) => console.error("[Error Hook]", err),
});

const app = new Runtime({ engine, bus, errorHandler });

// ─── 2. Dependency Injection ───────────────────────────────

app.provide("db", "postgres://localhost:5432/mydb");

// ─── 3. Global Event Listeners ─────────────────────────────

bus.on("request:start", (ctx) => {
    console.log(`→ ${ctx.req.method} ${new URL(ctx.req.url).pathname}`);
});

// ─── 4. Router Plugin ──────────────────────────────────────

const router = new Router();

// Simple GET
router.get("/", (ctx) => {
    ctx.json({ message: "Welcome to SinwanJS v2!" });
});

// Path Parameters & DI
router.get("/users/:id", (ctx) => {
    const db = ctx.service<string>("db");
    ctx.json({
        userId: ctx.params.id,
        source: db,
    });
});

// Body Parsing
router.post("/echo", async (ctx) => {
    const body = await ctx.parseBody();
    ctx.json({ received: body });
});

// Streaming Responses
router.get("/stream", (ctx) => {
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode("Hello...\n"));
            setTimeout(() => {
                controller.enqueue(new TextEncoder().encode("World!\n"));
                controller.close();
            }, 500);
        },
    });

    ctx.stream(stream, 200, "text/plain");
});

app.use(router);

// ─── 5. Fallback Step (404) ────────────────────────────────

const notFoundStep: Step = {
    name: "not-found",
    async run(ctx) {
        ctx.json({ error: "Not Found" }, 404);
    },
};
app.engine.add(notFoundStep);

// ─── 6. Start Server ───────────────────────────────────────

const server = Bun.serve({
    port: 3000,
    fetch: (req) => app.fetch(req),
});

console.log(`🚀 SinwanJS engine running at http://localhost:${server.port}`);
console.log("Try:");
console.log("  curl http://localhost:3000/");
console.log("  curl http://localhost:3000/users/42");
console.log("  curl -X POST -H 'Content-Type: application/json' -d '{\"hello\":\"world\"}' http://localhost:3000/echo");
console.log("  curl http://localhost:3000/stream");
