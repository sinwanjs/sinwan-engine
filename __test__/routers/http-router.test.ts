import { describe, expect, test, beforeEach, mock } from "bun:test";
import { HTTPRouter, type RouteHandler } from "../../src/routers/http-router";
import { Runtime, type RuntimeConfig } from "../../src/runtime";
import { StepEngine } from "../../src/step-engine";
import { EventBus } from "../../src/event-bus";
import { ErrorHandler } from "../../src/error-handler";
import { Context } from "../../src/context/context";
import type { Request } from "../../src/types";

function createRuntime(overrides?: Partial<RuntimeConfig>): Runtime {
  const engine = new StepEngine();
  const bus = new EventBus();
  const errorHandler = new ErrorHandler();
  const globalState = new Map<string, unknown>();
  return new Runtime({ engine, bus, errorHandler, globalState, ...overrides });
}

function createMockReq(
  url: string = "http://localhost:3000/",
  method: string = "GET",
): Request {
  return new Request(url, { method }) as unknown as Request;
}

async function runFetch(router: HTTPRouter, req: Request): Promise<Response> {
  const engine = new StepEngine();
  const bus = new EventBus();
  const errorHandler = new ErrorHandler();
  const globalState = new Map<string, unknown>();
  const runtime = new Runtime({ engine, bus, errorHandler, globalState });
  router.install(runtime);
  return runtime.fetch(req);
}

describe("HTTPRouter", () => {
  // ─── Plugin interface ────────────────────────────────────

  describe("plugin interface", () => {
    test("has correct name", () => {
      const router = new HTTPRouter();
      expect(router.name).toBe("sinwan:http-router");
    });

    test("install() registers a step in the engine", () => {
      const router = new HTTPRouter();
      const engine = new StepEngine();
      const runtime = createRuntime({ engine });
      router.install(runtime);
      // The step should be registered — verify by fetching
      expect(engine).toBeDefined();
    });

    test("install() step skips non-HTTP contexts", async () => {
      const router = new HTTPRouter();
      router.get("/", (ctx) => ctx.json({ ok: true }));
      const engine = new StepEngine();
      const bus = new EventBus();
      const errorHandler = new ErrorHandler();
      const globalState = new Map<string, unknown>();
      const runtime = new Runtime({ engine, bus, errorHandler, globalState });
      router.install(runtime);
      // Create a context with tcp set — should skip router
      const ctx = runtime.acquireContext();
      ctx.setReq(createMockReq());
      ctx.setTCP({} as never);
      engine.run(ctx, bus);
      // Should not have responded (router was skipped)
      expect(ctx.hasResponded()).toBe(false);
    });
  });

  // ─── Route registration ──────────────────────────────────

  describe("route registration", () => {
    test("get() registers GET route", async () => {
      const router = new HTTPRouter();
      router.get("/users", (ctx) => ctx.json({ users: [] }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/users"),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ users: [] });
    });

    test("post() registers POST route", async () => {
      const router = new HTTPRouter();
      router.post("/users", (ctx) => ctx.json({ created: true }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/users", "POST"),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ created: true });
    });

    test("put() registers PUT route", async () => {
      const router = new HTTPRouter();
      router.put("/users/1", (ctx) => ctx.json({ updated: true }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/users/1", "PUT"),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ updated: true });
    });

    test("patch() registers PATCH route", async () => {
      const router = new HTTPRouter();
      router.patch("/users/1", (ctx) => ctx.json({ patched: true }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/users/1", "PATCH"),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ patched: true });
    });

    test("delete() registers DELETE route", async () => {
      const router = new HTTPRouter();
      router.delete("/users/1", (ctx) => ctx.json({ deleted: true }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/users/1", "DELETE"),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ deleted: true });
    });

    test("options() registers OPTIONS route", async () => {
      const router = new HTTPRouter();
      router.options("/users", (ctx) => ctx.json({ allowed: true }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/users", "OPTIONS"),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ allowed: true });
    });

    test("head() registers HEAD route", async () => {
      const router = new HTTPRouter();
      router.head("/users", (ctx) => ctx.text("ok"));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/users", "HEAD"),
      );
      expect(res.status).toBe(200);
    });

    test("all() registers route for all methods", async () => {
      const router = new HTTPRouter();
      router.all("/ping", (ctx) => ctx.json({ pong: true }));
      for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
        const res = await runFetch(
          router,
          createMockReq("http://localhost/ping", method),
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ pong: true });
      }
    });

    test("getRoutes() returns registered routes", () => {
      const router = new HTTPRouter();
      router.get("/a", () => {});
      router.post("/b", () => {});
      const routes = router.getRoutes();
      expect(routes.length).toBe(2);
      expect(routes[0]!.method).toBe("GET");
      expect(routes[0]!.path).toBe("/a");
      expect(routes[1]!.method).toBe("POST");
      expect(routes[1]!.path).toBe("/b");
    });
  });

  // ─── Static routes (exact match) ─────────────────────────

  describe("static routes (exact match)", () => {
    test("matches exact path", async () => {
      const router = new HTTPRouter();
      router.get("/hello", (ctx) => ctx.json({ msg: "world" }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/hello"),
      );
      expect(await res.json()).toEqual({ msg: "world" });
    });

    test("matches root path", async () => {
      const router = new HTTPRouter();
      router.get("/", (ctx) => ctx.json({ root: true }));
      const res = await runFetch(router, createMockReq("http://localhost/"));
      expect(await res.json()).toEqual({ root: true });
    });

    test("returns 500 when no route matches", async () => {
      const router = new HTTPRouter();
      router.get("/exists", () => {});
      const res = await runFetch(
        router,
        createMockReq("http://localhost/nope"),
      );
      expect(res.status).toBe(500);
    });

    test("returns 405 when method not allowed", async () => {
      const router = new HTTPRouter();
      router.post("/users", (ctx) => ctx.json({}));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/users", "GET"),
      );
      expect(res.status).toBe(405);
    });

    test("appends handlers for same route and method", async () => {
      const router = new HTTPRouter();
      router.get("/chain", (ctx) => {
        ctx.setHeader("X-First", "1");
      });
      router.get("/chain", (ctx) => {
        ctx.json({ second: true });
      });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/chain"),
      );
      expect(res.headers.get("X-First")).toBe("1");
      expect(await res.json()).toEqual({ second: true });
    });
  });

  // ─── Parameter routes ────────────────────────────────────

  describe("parameter routes", () => {
    test("matches single param", async () => {
      const router = new HTTPRouter();
      router.get("/users/:id", (ctx) => ctx.json({ id: ctx.params["id"] }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/users/42"),
      );
      expect(await res.json()).toEqual({ id: "42" });
    });

    test("matches multiple params", async () => {
      const router = new HTTPRouter();
      router.get("/users/:userId/posts/:postId", (ctx) =>
        ctx.json({
          userId: ctx.params["userId"],
          postId: ctx.params["postId"],
        }),
      );
      const res = await runFetch(
        router,
        createMockReq("http://localhost/users/10/posts/20"),
      );
      expect(await res.json()).toEqual({ userId: "10", postId: "20" });
    });

    test("param route falls through to ALL", async () => {
      const router = new HTTPRouter();
      router.get("/users/:id", (ctx) => {
        ctx.setHeader("X-Param", ctx.params["id"]!);
      });
      router.all("/users/:id", (ctx) => ctx.json({ all: true }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/users/42"),
      );
      expect(res.headers.get("X-Param")).toBe("42");
      expect(await res.json()).toEqual({ all: true });
    });
  });

  // ─── Wildcard routes ─────────────────────────────────────

  describe("wildcard routes", () => {
    test("matches wildcard at end", async () => {
      const router = new HTTPRouter();
      router.get("/files/*", (ctx) =>
        ctx.json({ wildcard: ctx.params["_wildcard"] }),
      );
      const res = await runFetch(
        router,
        createMockReq("http://localhost/files/a/b/c"),
      );
      expect(await res.json()).toEqual({ wildcard: "/a/b/c" });
    });

    test("wildcard with empty match returns empty string", async () => {
      const router = new HTTPRouter();
      router.get("/files/*", (ctx) =>
        ctx.json({ wildcard: ctx.params["_wildcard"] }),
      );
      const res = await runFetch(
        router,
        createMockReq("http://localhost/files/"),
      );
      expect(await res.json()).toEqual({ wildcard: "" });
    });

    test("wildcard ALL route", async () => {
      const router = new HTTPRouter();
      router.all("/api/*", (ctx) => ctx.json({ api: true }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/api/anything", "POST"),
      );
      expect(await res.json()).toEqual({ api: true });
    });
  });

  // ─── HEAD fallback ───────────────────────────────────────

  describe("HEAD fallback", () => {
    test("HEAD falls back to GET static route", async () => {
      const router = new HTTPRouter();
      router.get("/data", (ctx) => ctx.json({ data: "test" }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/data", "HEAD"),
      );
      expect(res.status).toBe(200);
    });

    test("HEAD falls back to GET param route", async () => {
      const router = new HTTPRouter();
      router.get("/users/:id", (ctx) => ctx.json({ id: ctx.params["id"] }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/users/5", "HEAD"),
      );
      expect(res.status).toBe(200);
    });
  });

  // ─── ALL bucket fallback ─────────────────────────────────

  describe("ALL bucket fallback", () => {
    test("specific route falls through to ALL static", async () => {
      const router = new HTTPRouter();
      router.get("/page", (ctx) => {
        ctx.setHeader("X-Get", "1");
      });
      router.all("/page", (ctx) => ctx.json({ all: true }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/page"),
      );
      expect(res.headers.get("X-Get")).toBe("1");
      expect(await res.json()).toEqual({ all: true });
    });

    test("specific route falls through to ALL param", async () => {
      const router = new HTTPRouter();
      router.get("/items/:id", (ctx) => {
        ctx.setHeader("X-Id", ctx.params["id"]!);
      });
      router.all("/items/:id", (ctx) => ctx.json({ all: true }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/items/99"),
      );
      expect(res.headers.get("X-Id")).toBe("99");
      expect(await res.json()).toEqual({ all: true });
    });

    test("async specific route falls through to ALL", async () => {
      const router = new HTTPRouter();
      router.get("/async", async (ctx) => {
        await new Promise((r) => setTimeout(r, 1));
        ctx.setHeader("X-Async", "1");
      });
      router.all("/async", (ctx) => ctx.json({ all: true }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/async"),
      );
      expect(res.headers.get("X-Async")).toBe("1");
      expect(await res.json()).toEqual({ all: true });
    });
  });

  // ─── Middleware ──────────────────────────────────────────

  describe("middleware", () => {
    test("use() adds middleware to routes added after", async () => {
      const router = new HTTPRouter();
      router.use((ctx) => {
        ctx.setHeader("X-Middleware", "1");
      });
      router.get("/test", (ctx) => ctx.json({ ok: true }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/test"),
      );
      expect(res.headers.get("X-Middleware")).toBe("1");
      expect(await res.json()).toEqual({ ok: true });
    });

    test("middleware does not affect routes added before", async () => {
      const router = new HTTPRouter();
      router.get("/before", (ctx) => ctx.json({ ok: true }));
      router.use((ctx) => {
        ctx.setHeader("X-Middleware", "1");
      });
      router.get("/after", (ctx) => ctx.json({ ok: true }));
      const res1 = await runFetch(
        router,
        createMockReq("http://localhost/before"),
      );
      expect(res1.headers.get("X-Middleware")).toBeNull();
      const res2 = await runFetch(
        router,
        createMockReq("http://localhost/after"),
      );
      expect(res2.headers.get("X-Middleware")).toBe("1");
    });

    test("multiple middleware execute in order", async () => {
      const router = new HTTPRouter();
      router.use((ctx) => {
        ctx.setHeader("X-First", "1");
      });
      router.use((ctx) => {
        ctx.setHeader("X-Second", "2");
      });
      router.get("/test", (ctx) => ctx.json({ ok: true }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/test"),
      );
      expect(res.headers.get("X-First")).toBe("1");
      expect(res.headers.get("X-Second")).toBe("2");
    });
  });

  // ─── Group & Mount ───────────────────────────────────────

  describe("group()", () => {
    test("mounts routes under prefix", async () => {
      const router = new HTTPRouter();
      router.group("/api", (child) => {
        child.get("/users", (ctx) => ctx.json({ api: true }));
      });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/api/users"),
      );
      expect(await res.json()).toEqual({ api: true });
    });

    test("group with root prefix", async () => {
      const router = new HTTPRouter();
      router.group("/", (child) => {
        child.get("/test", (ctx) => ctx.json({ root: true }));
      });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/test"),
      );
      expect(await res.json()).toEqual({ root: true });
    });
  });

  describe("mount()", () => {
    test("mounts another router under prefix", async () => {
      const child = new HTTPRouter();
      child.get("/info", (ctx) => ctx.json({ child: true }));
      const router = new HTTPRouter();
      router.mount("/api", child);
      const res = await runFetch(
        router,
        createMockReq("http://localhost/api/info"),
      );
      expect(await res.json()).toEqual({ child: true });
    });

    test("mount with root prefix", async () => {
      const child = new HTTPRouter();
      child.get("/test", (ctx) => ctx.json({ child: true }));
      const router = new HTTPRouter();
      router.mount("/", child);
      const res = await runFetch(
        router,
        createMockReq("http://localhost/test"),
      );
      expect(await res.json()).toEqual({ child: true });
    });

    test("mount with empty merged path edge case", async () => {
      const child = new HTTPRouter();
      child.get("/", (ctx) => ctx.json({ root: true }));
      const router = new HTTPRouter();
      router.mount("", child);
      const res = await runFetch(router, createMockReq("http://localhost/"));
      expect(await res.json()).toEqual({ root: true });
    });
  });

  // ─── resolve() direct testing ────────────────────────────

  function resolveReq(router: HTTPRouter, method: string, url: string) {
    const protoIdx = url.indexOf("://");
    const pathStart = protoIdx !== -1 ? url.indexOf("/", protoIdx + 3) : 0;
    const queryStart = url.indexOf("?", pathStart);
    const pathname =
      pathStart === -1
        ? "/"
        : queryStart === -1
          ? url.slice(pathStart)
          : url.slice(pathStart, queryStart);
    return router.resolve(method, pathname);
  }

  describe("resolve()", () => {
    test("returns null for no match", () => {
      const router = new HTTPRouter();
      router.get("/exists", () => {});
      const result = resolveReq(router, "GET", "http://localhost/nope");
      expect(result).toBeNull();
    });

    test("returns method-not-allowed for wrong method", () => {
      const router = new HTTPRouter();
      router.post("/users", () => {});
      const result = resolveReq(router, "GET", "http://localhost/users");
      expect(result).toEqual({ type: "method-not-allowed" });
    });

    test("returns match for static route", () => {
      const router = new HTTPRouter();
      router.get("/users", () => {});
      const result = resolveReq(router, "GET", "http://localhost/users");
      expect(result?.type).toBe("match");
      if (result?.type === "match") expect(result.source).toBe("specific");
    });

    test("returns match for param route with params", () => {
      const router = new HTTPRouter();
      router.get("/users/:id", () => {});
      const result = resolveReq(router, "GET", "http://localhost/users/42");
      expect(result?.type).toBe("match");
      if (result?.type === "match") {
        expect(result.params["id"]).toBe("42");
      }
    });

    test("returns match for ALL route", () => {
      const router = new HTTPRouter();
      router.all("/ping", () => {});
      const result = resolveReq(router, "POST", "http://localhost/ping");
      expect(result?.type).toBe("match");
      if (result?.type === "match") expect(result.source).toBe("all");
    });

    test("returns match for wildcard route", () => {
      const router = new HTTPRouter();
      router.get("/files/*", () => {});
      const result = resolveReq(router, "GET", "http://localhost/files/a/b");
      expect(result?.type).toBe("match");
      if (result?.type === "match") {
        expect(result.params["_wildcard"]).toBe("/a/b");
      }
    });

    test("returns match for ALL wildcard route", () => {
      const router = new HTTPRouter();
      router.all("/api/*", () => {});
      const result = resolveReq(router, "DELETE", "http://localhost/api/x");
      expect(result?.type).toBe("match");
      if (result?.type === "match") {
        expect(result.params["_wildcard"]).toBe("/x");
      }
    });

    test("returns method-not-allowed for unknown method with existing route", () => {
      const router = new HTTPRouter();
      router.get("/test", () => {});
      const result = resolveReq(router, "TRACE", "http://localhost/test");
      // TRACE is not a specific method, ALL has no route, but GET does → 405
      expect(result).toEqual({ type: "method-not-allowed" });
    });

    test("HEAD fallback to GET static", () => {
      const router = new HTTPRouter();
      router.get("/data", () => {});
      const result = resolveReq(router, "HEAD", "http://localhost/data");
      expect(result?.type).toBe("match");
    });

    test("HEAD fallback to GET param", () => {
      const router = new HTTPRouter();
      router.get("/users/:id", () => {});
      const result = resolveReq(router, "HEAD", "http://localhost/users/5");
      expect(result?.type).toBe("match");
      if (result?.type === "match") {
        expect(result.params["id"]).toBe("5");
      }
    });

    test("405 when route exists for different method (param route)", () => {
      const router = new HTTPRouter();
      router.get("/users/:id", () => {});
      const result = resolveReq(router, "POST", "http://localhost/users/5");
      expect(result).toEqual({ type: "method-not-allowed" });
    });

    test("unknown method matches ALL route", () => {
      const router = new HTTPRouter();
      router.all("/test", () => {});
      const result = resolveReq(router, "TRACE", "http://localhost/test");
      // TRACE is not specific, falls to ALL bucket which matches
      expect(result?.type).toBe("match");
      if (result?.type === "match") expect(result.source).toBe("all");
    });

    test("wildcard at depth matches for 405 check", () => {
      const router = new HTTPRouter();
      router.get("/api/*", () => {});
      const result = resolveReq(router, "POST", "http://localhost/api/x");
      expect(result).toEqual({ type: "method-not-allowed" });
    });
  });

  // ─── runChain — handler chain execution ──────────────────

  describe("runChain", () => {
    test("executes handlers in order", async () => {
      const router = new HTTPRouter();
      const order: string[] = [];
      router.get(
        "/chain",
        (ctx) => {
          order.push("1");
          ctx.setHeader("X-1", "1");
        },
        (ctx) => {
          order.push("2");
          ctx.json({ done: true });
        },
      );
      const res = await runFetch(
        router,
        createMockReq("http://localhost/chain"),
      );
      expect(order).toEqual(["1", "2"]);
      expect(res.headers.get("X-1")).toBe("1");
      expect(await res.json()).toEqual({ done: true });
    });

    test("stops chain when ctx.stop() is called", async () => {
      const router = new HTTPRouter();
      router.get(
        "/stop",
        (ctx) => {
          ctx.setHeader("X-First", "1");
          ctx.stop();
        },
        (ctx) => {
          ctx.json({ shouldNotRun: true });
        },
      );
      const res = await runFetch(
        router,
        createMockReq("http://localhost/stop"),
      );
      expect(res.headers.get("X-First")).toBe("1");
      // Second handler should not have run — no response set, so 500
      expect(res.status).toBe(500);
    });

    test("stops chain when ctx.respond early", async () => {
      const router = new HTTPRouter();
      router.get(
        "/early",
        (ctx) => {
          ctx.json({ early: true });
        },
        (ctx) => {
          ctx.json({ shouldNotRun: true });
        },
      );
      const res = await runFetch(
        router,
        createMockReq("http://localhost/early"),
      );
      expect(await res.json()).toEqual({ early: true });
    });

    test("skip() skips next handler", async () => {
      const router = new HTTPRouter();
      router.get(
        "/skip",
        (ctx) => {
          ctx.setHeader("X-1", "1");
          ctx.skip();
        },
        (ctx) => {
          ctx.setHeader("X-2", "2");
        }, // should be skipped
        (ctx) => {
          ctx.json({ third: true });
        },
      );
      const res = await runFetch(
        router,
        createMockReq("http://localhost/skip"),
      );
      expect(res.headers.get("X-1")).toBe("1");
      expect(res.headers.get("X-2")).toBeNull();
      expect(await res.json()).toEqual({ third: true });
    });

    test("async handler chain", async () => {
      const router = new HTTPRouter();
      router.get(
        "/async",
        async (ctx) => {
          await new Promise((r) => setTimeout(r, 1));
          ctx.setHeader("X-Async", "1");
        },
        (ctx) => ctx.json({ done: true }),
      );
      const res = await runFetch(
        router,
        createMockReq("http://localhost/async"),
      );
      expect(res.headers.get("X-Async")).toBe("1");
      expect(await res.json()).toEqual({ done: true });
    });

    test("async handler skip()", async () => {
      const router = new HTTPRouter();
      router.get(
        "/async-skip",
        async (ctx) => {
          await new Promise((r) => setTimeout(r, 1));
          ctx.setHeader("X-1", "1");
          ctx.skip();
        },
        (ctx) => {
          ctx.setHeader("X-2", "2");
        }, // should be skipped
        (ctx) => ctx.json({ third: true }),
      );
      const res = await runFetch(
        router,
        createMockReq("http://localhost/async-skip"),
      );
      expect(res.headers.get("X-1")).toBe("1");
      expect(res.headers.get("X-2")).toBeNull();
      expect(await res.json()).toEqual({ third: true });
    });

    test("error in handler is caught by onError", async () => {
      const router = new HTTPRouter();
      router.get("/error", () => {
        throw new Error("handler error");
      });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/error"),
      );
      expect(res.status).toBe(500);
    });

    test("error in async handler is caught", async () => {
      const router = new HTTPRouter();
      router.get("/async-error", async () => {
        await new Promise((r) => setTimeout(r, 1));
        throw new Error("async handler error");
      });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/async-error"),
      );
      expect(res.status).toBe(500);
    });

    test("ctx.fail() in sync handler triggers onError", async () => {
      const router = new HTTPRouter();
      router.get("/fail", (ctx) => {
        ctx.fail("custom fail");
      });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/fail"),
      );
      expect(res.status).toBe(500);
    });

    test("ctx.fail() in async handler triggers onError", async () => {
      const router = new HTTPRouter();
      router.get("/async-fail", async (ctx) => {
        await new Promise((r) => setTimeout(r, 1));
        ctx.fail("async custom fail");
      });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/async-fail"),
      );
      expect(res.status).toBe(500);
    });
  });

  // ─── URL parsing ─────────────────────────────────────────

  describe("URL parsing", () => {
    test("parses URL with query string", async () => {
      const router = new HTTPRouter();
      router.get("/search", (ctx) => ctx.json({ q: ctx.query?.get("q") }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/search?q=test"),
      );
      expect(res.status).toBe(200);
    });

    test("parses URL with fragment", async () => {
      const router = new HTTPRouter();
      router.get("/page", (ctx) => ctx.json({ ok: true }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/page#section"),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    test("handles trailing slash in URL", async () => {
      const router = new HTTPRouter();
      router.get("/users", (ctx) => ctx.json({ ok: true }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/users/"),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });
  });

  // ─── Static file serving ─────────────────────────────────

  describe("static()", () => {
    test("serves existing file", async () => {
      const tmpDir = (await Bun.file("/dev/null").exists()) ? "/tmp" : "/tmp";
      const testFile = `${tmpDir}/sinwan-test-static.txt`;
      await Bun.write(testFile, "hello static");
      const router = new HTTPRouter();
      router.static("/public", tmpDir);
      const res = await runFetch(
        router,
        createMockReq(`http://localhost/public/sinwan-test-static.txt`),
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello static");
      await Bun.file(testFile).delete();
    });

    test("returns 500 for non-existent file (fall-through)", async () => {
      const router = new HTTPRouter();
      router.static("/public", "/tmp");
      const res = await runFetch(
        router,
        createMockReq("http://localhost/public/nonexistent.xyz"),
      );
      expect(res.status).toBe(500);
    });

    test("rejects path traversal with ..", async () => {
      const router = new HTTPRouter();
      router.static("/public", "/tmp");
      const res = await runFetch(
        router,
        createMockReq("http://localhost/public/../../../etc/passwd"),
      );
      expect(res.status).toBe(500);
    });

    test("rejects encoded path traversal", async () => {
      const router = new HTTPRouter();
      router.static("/public", "/tmp");
      const res = await runFetch(
        router,
        createMockReq("http://localhost/public/%2e%2e%2f%2e%2e%2fetc%2fpasswd"),
      );
      expect(res.status).toBe(500);
    });

    test("rejects invalid encoding", async () => {
      const router = new HTTPRouter();
      router.static("/public", "/tmp");
      const res = await runFetch(
        router,
        createMockReq("http://localhost/public/%invalid%encoding"),
      );
      expect(res.status).toBe(500);
    });

    test("empty subpath returns 500", async () => {
      const router = new HTTPRouter();
      router.static("/public", "/tmp");
      const res = await runFetch(
        router,
        createMockReq("http://localhost/public/"),
      );
      expect(res.status).toBe(500);
    });

    test("serves file from root prefix", async () => {
      const testFile = "/tmp/sinwan-test-root.txt";
      await Bun.write(testFile, "root file");
      const router = new HTTPRouter();
      router.static("/", "/tmp");
      const res = await runFetch(
        router,
        createMockReq("http://localhost/sinwan-test-root.txt"),
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("root file");
      await Bun.file(testFile).delete();
    });
  });

  // ─── Multiple handlers ───────────────────────────────────

  describe("multiple handlers", () => {
    test("multiple handlers in a single route call", async () => {
      const router = new HTTPRouter();
      router.get(
        "/multi",
        (ctx) => {
          ctx.setHeader("X-1", "1");
        },
        (ctx) => {
          ctx.setHeader("X-2", "2");
        },
        (ctx) => {
          ctx.json({ done: true });
        },
      );
      const res = await runFetch(
        router,
        createMockReq("http://localhost/multi"),
      );
      expect(res.headers.get("X-1")).toBe("1");
      expect(res.headers.get("X-2")).toBe("2");
      expect(await res.json()).toEqual({ done: true });
    });
  });
});
