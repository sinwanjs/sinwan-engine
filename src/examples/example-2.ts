/**
 * SinwanJS Core Runtime — Comprehensive Example
 *
 * This example demonstrates the full power of the SinwanJS V2 architecture:
 *  1. Unified App Facade (SinwanApp)
 *  2. Application Lifecycle Events (init, ready)
 *  3. Global and Route-level Middleware
 *  4. Path Parameter Extraction
 *  5. Event-Driven Lifecycle (EventBus)
 *  6. Robust Server-Sent Events (SSE) with cleanup
 *  7. Response Streaming
 *  8. Error Handling and Recovery
 */

import { Sinwan } from "../sinwan";
import type { Context } from "../context";
import type { Step } from "../types";

// ─── 1. Initialize Application ──────────────────────────────

const app = new Sinwan({
    // idleTimeout: 60, // 60 seconds idle timeout
    onError: (err) => {
        console.error("🔥 [Global Error]:", err instanceof Error ? err.message : err);
    },
});

// ─── 2. Lifecycle Listeners ─────────────────────────────────

app.bus.on("app:init", (ctx: Context) => {
    console.log("🛠️  System initializing...");
});

app.bus.on("app:shutdown", (ctx: Context) => {
    ctx.setGlobal("shutdown", true);
    console.log("🛑 System shutting down...");
});

app.bus.on("app:destroy", () => {
    console.log("💀 System destroyed.");
});

app.bus.on("app:ready", (_, payload) => {
    console.log(`✅ System ready on port ${payload?.port}`);
});



// ─── 3. Global Middleware & Events ──────────────────────────

// Simple logger middleware
app.use((ctx) => {
    ctx.set("startTime", Date.now());
});

// Event listener for monitoring requests
app.bus.on("request:start", (ctx) => {
    console.log(`→ ${ctx.req.method} ${new URL(ctx.req.url).pathname}`);
});

app.bus.on("request:end", (ctx, payload) => {
    const start = ctx.get<number>("startTime");
    const duration = start ? `${Date.now() - start}ms` : "n/a";
    console.log(`← ${ctx.statusCode} (${duration})`);
});

// ─── 4. Standard Routing ────────────────────────────────────

app.get("/", (ctx) => {

    ctx.json({
        framework: "SinwanJS",
        version: "2.0.0",
        status: "online",
        message: "Welcome to the future of deterministic middleware."
    });
});

app.get("/users/:id", (ctx) => {
    const userId = ctx.params.id;
    ctx.json({
        id: userId,
        name: `User ${userId}`,
        role: "developer"
    });
});

// Body Parsing Example
app.post("/echo", async (ctx) => {
    const body = await ctx.parseBody();
    ctx.json({
        received: body,
        processedAt: new Date().toISOString()
    });
});

// ─── 5. Advanced: Route Grouping ───────────────────────────

app.group("/api/v1", (api) => {
    // Middleware specific to this group
    api.use((ctx) => {
        ctx.setHeader("X-API-Version", "v1");
    });

    api.get("/status", (ctx) => {
        ctx.json({ status: "healthy", services: ["auth", "database", "cache"] });
    });
});

// ─── 6. Advanced: SSE & Streaming ──────────────────────────

// Server-Sent Events (SSE)
app.get("/events", (ctx) => {
    // Config: 10s retry, infinite timeout for SSE
    const sse = ctx.sse({ retry: 10000, timeout: 0 });

    let counter = 0;
    console.log("📡 SSE Client connected");

    const interval = setInterval(() => {
        counter += 1;

        // Send a structured event
        sse.send(
            { message: `Notification #${counter}`, time: new Date().toLocaleTimeString() },
            "notification",
            `event-${counter}`
        );

        // Stop after 10 events
        if (counter >= 10) {
            clearInterval(interval);
            sse.close();
        }
    }, 2000);

    // CRITICAL: Cleanup if client disconnects
    ctx.on("context:dispose", () => {
        console.log("🔌 SSE Client disconnected, clearing interval.");
        clearInterval(interval);
    });
});

// Binary/Text Streaming
app.get("/download", (ctx) => {
    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode("Starting download...\n"));

            let count = 0;
            const t = setInterval(() => {
                count++;
                controller.enqueue(encoder.encode(`Chunk #${count} processed\n`));
                if (count >= 5) {
                    clearInterval(t);
                    controller.enqueue(encoder.encode("Download complete.\n"));
                    controller.close();
                }
            }, 500);
        }
    });

    ctx.stream(stream, 200, "text/plain");
});

// ─── 7. Error Handling Demonstration ────────────────────────

app.get("/error", () => {
    throw new Error("This is a simulated crash to demonstrate error recovery.");
});

app.group("/group", (group) => {
    group.use((ctx) => {
        ctx.setHeader("X-Group", "group");
    });
    group.get("/", (ctx) => {
        ctx.json({ message: "This is a group" });
    });
    group.group("/sub-group", (subGroup) => {
        subGroup.get("/", (ctx) => {
            ctx.json({ message: "This is a sub-group" });
        });
    });
});

// ─── 8. Fallback (404) ──────────────────────────────────────

const notFoundStep: Step = {
    name: "not-found",
    async run(ctx) {
        if (!ctx.hasResponded()) {
            ctx.json({ error: "Resource not found", code: 404 }, 404);
        }
    },
};
app.engine.add(notFoundStep);

// ─── 9. Launch ──────────────────────────────────────────────

const port = 3000;

// Initialize the app lifecycle (Strict Mode)
await app.init();

app.listen(port, () => {
    console.log(`
  🚀 SinwanJS v2 is running!
  --------------------------------------------------
  Base URL:    http://localhost:${port}/
  SSE Events:  http://localhost:${port}/events
  Streaming:   http://localhost:${port}/download
  User API:    http://localhost:${port}/users/42
  --------------------------------------------------
  Try: curl -X POST -H "Content-Type: application/json" -d '{"test":"ok"}' http://localhost:3000/echo
  `);
});


process.on("SIGINT", async () => {
    await app.stop();
    process.exit(0);
});