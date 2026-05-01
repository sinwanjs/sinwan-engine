/**
 * SinwanJS Core Runtime — v2 Example Usage
 *
 * Demonstrates:
 *  1. Dependency Injection (DI)
 *  2. Router Plugin (with URL params & Nested Groups)
 *  3. Route-Level and Router-Level Middleware
 *  4. Built-in Body Parsing
 *  5. Streaming Responses
 *
 * Run with: bun run src/example.ts
 */

import { StepEngine } from "../step-engine";
import { EventBus } from "../event-bus";
import { ErrorHandler } from "../error-handler";
import { Runtime } from "../runtime";
import { Router } from "../router";
import type { RouteHandler } from "../router";
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
    ctx.set("requestStartTime", performance.now());
    console.log(`→ ${ctx.req.method} ${new URL(ctx.req.url).pathname}`);
});


bus.on("request:end", (ctx) => {
    const startTime = ctx.get<number>("requestStartTime");
    const duration = startTime !== undefined
        ? `${(performance.now() - startTime).toFixed(2)}ms`
        : "unknown";
    console.log(`← ${ctx.statusCode} [${duration}]`);
});


// ─── 4. Router Plugin & Middleware ─────────────────────────

const router = new Router();

// Router-Level Middleware (applies to all routes added to `router`)
router.use((ctx) => {
    console.log(`[Middleware] Checking route: ${ctx.req.url}`);
});

// Simple GET
router.get("/", (ctx) => {
    ctx.json({ message: "Welcome to SinwanJS v2!" });
});

// Route-Level Middleware (Array of handlers)
const requireAuth: RouteHandler = (ctx) => {
    const auth = ctx.req.headers.get("Authorization");
    if (auth !== "Bearer secret-token") {
        ctx.json({ error: "Unauthorized" }, 401);
        // Auto-stops execution, the next handler won't run
    }
};

router.get("/secure-data", requireAuth, (ctx) => {
    ctx.json({ secret: "This is protected data!" });
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

// ─── 5. Nested Router Groups ───────────────────────────────

// Mount the group under the prefix "/api"
router.group("/api", (api) => {
    api.use((ctx) => console.log("[API Group Middleware] Running..."));

    api.get("/status", (ctx) => {
        ctx.json({ status: "API is healthy" });
    });

    // Nested group: "/api/v1"
    api.group("/v1", (v1) => {
        v1.use((ctx) => console.log("[V1 Group Middleware] Running..."));

        v1.get("/users", (ctx) => {
            ctx.json({ users: ["Alice", "Bob"] });
        });

        // Nested deeply: "/api/v1/admin"
        v1.group("/admin", (admin) => {
            admin.use(requireAuth); // Protect all routes in this deep group

            admin.get("/dashboard", (ctx) => {
                ctx.json({ message: "Welcome to the Admin Dashboard" });
            });
        });
    });
});

// Register the main router to the app
app.use(router);

// ─── 6. Fallback Step (404) ────────────────────────────────

const notFoundStep: Step = {
    name: "not-found",
    async run(ctx) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        ctx.json({ error: "Not Found" }, 404);
    },
};

app.engine.add(notFoundStep);

// ─── 7. Start Server ───────────────────────────────────────

const server = Bun.serve({
    port: 3000,
    fetch: (req) => app.fetch(req),
});

console.log(`🚀 SinwanJS engine running at http://localhost:${server.port}`);
console.log("Try:");
console.log("  curl http://localhost:3000/");
console.log("  curl http://localhost:3000/api/status");
console.log("  curl http://localhost:3000/api/v1/users");
console.log("  curl -H 'Authorization: Bearer secret-token' http://localhost:3000/api/v1/admin/dashboard");
