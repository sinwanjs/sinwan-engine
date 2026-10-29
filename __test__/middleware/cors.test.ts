import { describe, expect, test } from "bun:test";
import { HTTPRouter } from "../../src/routers/http-router";
import { Runtime, type RuntimeConfig } from "../../src/runtime";
import { EventBus } from "../../src/event-bus";
import { ErrorHandler } from "../../src/error-handler";
import { cors, type CorsOptions } from "../../src/middleware/cors";
import { Sinwan } from "../../src/sinwan";
import { createHttpModule } from "../../src/modules";
import type { Request } from "../../src/types";

function createMockReq(
  url: string = "http://localhost:3000/",
  method: string = "GET",
  extraHeaders: Record<string, string> = {},
): Request {
  return new Request(url, {
    method,
    headers: extraHeaders,
  }) as unknown as Request;
}

async function runFetch(router: HTTPRouter, req: Request): Promise<Response> {
  const bus = new EventBus();
  const errorHandler = new ErrorHandler();
  const globalState = new Map<string, unknown>();
  const runtime = new Runtime({
    bus,
    errorHandler,
    globalState,
    httpRouter: router,
  });
  return runtime.fetch(req);
}

function corsApp(
  options?: CorsOptions | Parameters<typeof cors>[0],
  routePath = "/",
): HTTPRouter {
  const router = new HTTPRouter();
  router.use(cors(options as never));
  // Register both GET and OPTIONS so preflight requests run through a matched
  // OPTIONS route chain. Preflights with no OPTIONS route are covered by the
  // "unmatched requests" suite below.
  router.options(routePath, (ctx) => ctx.json({ preflight: true }));
  router.get(routePath, (ctx) => ctx.json({ ok: true }));
  return router;
}

describe("cors middleware", () => {
  // ─── Origin: wildcard ──────────────────────────────────────
  describe("origin: '*' (default)", () => {
    test("sets Access-Control-Allow-Origin: * with no Vary", async () => {
      const router = corsApp();
      const res = await runFetch(
        router,
        createMockReq("http://localhost/", "GET", { Origin: "https://x.com" }),
      );
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Vary")).toBe(null);
      expect(await res.json()).toEqual({ ok: true });
    });

    test("default cors() with no args allows any origin", async () => {
      const router = corsApp();
      const res = await runFetch(router, createMockReq());
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  // ─── Origin: fixed string ──────────────────────────────────
  describe("origin: fixed string", () => {
    test("reflects fixed origin and sets Vary: Origin", async () => {
      const router = corsApp({ origin: "https://app.example.com" });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/", "GET", {
          Origin: "https://other.com",
        }),
      );
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.example.com",
      );
      expect(res.headers.get("Vary")).toBe("Origin");
    });
  });

  // ─── Origin: array ─────────────────────────────────────────
  describe("origin: array", () => {
    const allowed = ["https://a.com", "https://b.com"];

    test("reflects allowed origin", async () => {
      const router = corsApp({ origin: allowed });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/", "GET", { Origin: "https://a.com" }),
      );
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://a.com",
      );
      expect(res.headers.get("Vary")).toBe("Origin");
    });

    test("omits Access-Control-Allow-Origin when not allowed", async () => {
      const router = corsApp({ origin: allowed });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/", "GET", {
          Origin: "https://evil.com",
        }),
      );
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(null);
      expect(res.headers.get("Vary")).toBe("Origin");
    });

    test("array containing a non-matching string falls through to false", async () => {
      // Covers isOriginAllowed array iteration (lines 168-174): each element
      // is tested; none match → returns false.
      const router = corsApp({
        origin: ["https://a.com", "https://b.com"],
      });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/", "GET", {
          Origin: "https://c.com",
        }),
      );
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(null);
      expect(res.headers.get("Vary")).toBe("Origin");
    });
  });

  // ─── Origin: boolean ───────────────────────────────────────
  describe("origin: boolean", () => {
    test("origin: true allows any origin (isOriginAllowed boolean branch)", async () => {
      const router = corsApp({ origin: true });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/", "GET", {
          Origin: "https://anything.com",
        }),
      );
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://anything.com",
      );
      expect(res.headers.get("Vary")).toBe("Origin");
    });

    test("origin: false disables CORS (no headers, chain continues)", async () => {
      const router = corsApp({ origin: false });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/", "GET", {
          Origin: "https://anything.com",
        }),
      );
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(null);
      expect(res.headers.get("Vary")).toBe(null);
      // Route handler still ran
      expect(await res.json()).toEqual({ ok: true });
    });
  });

  // ─── Origin: RegExp ────────────────────────────────────────
  describe("origin: RegExp", () => {
    test("matches pattern", async () => {
      const router = corsApp({ origin: /^https:\/\/.*\.example\.com$/ });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/", "GET", {
          Origin: "https://sub.example.com",
        }),
      );
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://sub.example.com",
      );
    });

    test("does not match non-matching origin", async () => {
      const router = corsApp({ origin: /^https:\/\/.*\.example\.com$/ });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/", "GET", {
          Origin: "https://evil.com",
        }),
      );
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(null);
    });
  });

  // ─── Credentials ───────────────────────────────────────────
  describe("credentials", () => {
    test("sets Access-Control-Allow-Credentials: true", async () => {
      const router = corsApp({ credentials: true });
      const res = await runFetch(router, createMockReq());
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    });

    test("omits header when credentials not set", async () => {
      const router = corsApp();
      const res = await runFetch(router, createMockReq());
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBe(null);
    });
  });

  // ─── Preflight (OPTIONS) ───────────────────────────────────
  describe("preflight (OPTIONS)", () => {
    test("returns 204 with CORS headers and empty body", async () => {
      const router = corsApp({
        origin: "https://app.example.com",
        credentials: true,
        maxAge: 7200,
        allowedHeaders: ["Content-Type", "Authorization"],
      });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/", "OPTIONS", {
          Origin: "https://app.example.com",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "X-Custom",
        }),
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.example.com",
      );
      expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
      expect(res.headers.get("Access-Control-Allow-Methods")).toBe(
        "GET,HEAD,PUT,PATCH,POST,DELETE,QUERY",
      );
      // allowedHeaders configured explicitly → not reflected, uses config
      expect(res.headers.get("Access-Control-Allow-Headers")).toBe(
        "Content-Type,Authorization",
      );
      expect(res.headers.get("Access-Control-Max-Age")).toBe("7200");
      expect(await res.text()).toBe("");
    });

    test("reflects Access-Control-Request-Headers when allowedHeaders omitted", async () => {
      const router = corsApp();
      const res = await runFetch(
        router,
        createMockReq("http://localhost/", "OPTIONS", {
          "Access-Control-Request-Headers": "X-Custom, X-Other",
        }),
      );
      expect(res.headers.get("Access-Control-Allow-Headers")).toBe(
        "X-Custom, X-Other",
      );
      // Vary should include Access-Control-Request-Headers
      const vary = res.headers.get("Vary") ?? "";
      expect(vary.toLowerCase()).toContain("access-control-request-headers");
    });

    test("uses custom optionsSuccessStatus", async () => {
      const router = corsApp({ optionsSuccessStatus: 200 });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/", "OPTIONS"),
      );
      expect(res.status).toBe(200);
    });

    test("preflightContinue: true passes to next handler", async () => {
      const router = new HTTPRouter();
      router.use(cors({ preflightContinue: true }));
      router.options("/", (ctx) => ctx.json({ handled: true }));
      router.get("/", (ctx) => ctx.json({ ok: true }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/", "OPTIONS"),
      );
      // The OPTIONS route handler responded, not the middleware
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ handled: true });
      // CORS headers still applied
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  // ─── exposedHeaders ────────────────────────────────────────
  describe("exposedHeaders", () => {
    test("joins array with comma", async () => {
      const router = corsApp({
        exposedHeaders: ["X-Total-Count", "X-Page"],
      });
      const res = await runFetch(router, createMockReq());
      expect(res.headers.get("Access-Control-Expose-Headers")).toBe(
        "X-Total-Count,X-Page",
      );
    });

    test("passes through string", async () => {
      const router = corsApp({ exposedHeaders: "X-Custom" });
      const res = await runFetch(router, createMockReq());
      expect(res.headers.get("Access-Control-Expose-Headers")).toBe("X-Custom");
    });

    test("empty string returns null (no header set)", async () => {
      // Covers configureExposedHeaders `return null` path (lines 272-273)
      // when the joined value is empty.
      const router = corsApp({ exposedHeaders: "" });
      const res = await runFetch(router, createMockReq());
      expect(res.headers.get("Access-Control-Expose-Headers")).toBe(null);
    });

    test("empty array returns null (no header set)", async () => {
      const router = corsApp({ exposedHeaders: [] });
      const res = await runFetch(router, createMockReq());
      expect(res.headers.get("Access-Control-Expose-Headers")).toBe(null);
    });
  });

  // ─── methods ───────────────────────────────────────────────
  describe("methods", () => {
    test("joins array with comma on preflight", async () => {
      const router = corsApp({ methods: ["GET", "POST"] });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/", "OPTIONS"),
      );
      expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET,POST");
    });

    test("default methods include QUERY", async () => {
      const router = corsApp();
      const res = await runFetch(
        router,
        createMockReq("http://localhost/", "OPTIONS"),
      );
      const methods = res.headers
        .get("Access-Control-Allow-Methods")!
        .split(",");
      expect(methods).toContain("QUERY");
      expect(methods).toEqual(
        expect.arrayContaining([
          "GET",
          "HEAD",
          "PUT",
          "PATCH",
          "POST",
          "DELETE",
          "QUERY",
        ]),
      );
    });
  });

  // ─── Dynamic options delegate ──────────────────────────────
  describe("dynamic options delegate", () => {
    test("per-request options switch", async () => {
      const router = corsApp((ctx, cb) => {
        const origin = ctx.req.headers.get("origin") ?? "";
        cb(null, { origin: origin.endsWith(".test") ? origin : false });
      });

      const allowed = await runFetch(
        router,
        createMockReq("http://localhost/", "GET", {
          Origin: "https://app.test",
        }),
      );
      expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.test",
      );

      const denied = await runFetch(
        router,
        createMockReq("http://localhost/", "GET", {
          Origin: "https://evil.com",
        }),
      );
      expect(denied.headers.get("Access-Control-Allow-Origin")).toBe(null);
    });

    test("delegate error propagates", async () => {
      const router = corsApp((_ctx, cb) => {
        cb(new Error("boom"));
      });
      const res = await runFetch(router, createMockReq());
      // ErrorHandler produces a 500 for thrown errors
      expect(res.status).toBe(500);
    });

    test("delegate that throws synchronously propagates", async () => {
      // Covers the try/catch in resolveOptionsDelegate (line 446) where the
      // delegate throws before invoking the callback.
      const router = corsApp(() => {
        throw new Error("sync throw");
      });
      const res = await runFetch(router, createMockReq());
      expect(res.status).toBe(500);
    });

    test("delegate that throws a non-Error value normalizes to Error", async () => {
      // Covers `new Error(String(err))` branch in resolveOptionsDelegate.
      const router = corsApp(() => {
        throw "string error"; // eslint-disable-line no-throw-literal
      });
      const res = await runFetch(router, createMockReq());
      expect(res.status).toBe(500);
    });
  });

  // ─── Dynamic origin delegate ───────────────────────────────
  describe("dynamic origin delegate", () => {
    test("async origin callback reflects allowed origin", async () => {
      const router = corsApp({
        origin: (origin, cb) => {
          if (!origin) return cb(null, false);
          cb(null, origin.endsWith(".example.com") ? origin : false);
        },
      });

      const allowed = await runFetch(
        router,
        createMockReq("http://localhost/", "GET", {
          Origin: "https://sub.example.com",
        }),
      );
      expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://sub.example.com",
      );

      const denied = await runFetch(
        router,
        createMockReq("http://localhost/", "GET", {
          Origin: "https://evil.com",
        }),
      );
      expect(denied.headers.get("Access-Control-Allow-Origin")).toBe(null);
    });

    test("origin delegate error propagates as 500", async () => {
      const router = corsApp({
        origin: (_origin, cb) => cb(new Error("origin fail")),
      });
      const res = await runFetch(router, createMockReq());
      expect(res.status).toBe(500);
    });

    test("origin delegate that throws synchronously propagates as 500", async () => {
      // Covers the try/catch in resolveOriginDelegate (line 462) where the
      // delegate throws before invoking the callback.
      const router = corsApp({
        origin: () => {
          throw new Error("origin sync throw");
        },
      });
      const res = await runFetch(router, createMockReq());
      expect(res.status).toBe(500);
    });

    test("origin delegate that throws a non-Error value normalizes to Error", async () => {
      // Covers `new Error(String(err))` branch in resolveOriginDelegate.
      const router = corsApp({
        origin: () => {
          throw "origin string error"; // eslint-disable-line no-throw-literal
        },
      });
      const res = await runFetch(router, createMockReq());
      expect(res.status).toBe(500);
    });
  });

  // ─── cors.preflight() helper ───────────────────────────────
  describe("cors.preflight()", () => {
    test("short-circuits OPTIONS with configured status", async () => {
      const router = new HTTPRouter();
      router.options("*", cors.preflight({ origin: "*", maxAge: 3600 }));
      router.get("/", (ctx) => ctx.json({ ok: true }));
      const res = await runFetch(
        router,
        createMockReq("http://localhost/anything", "OPTIONS"),
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Max-Age")).toBe("3600");
      expect(await res.text()).toBe("");
    });

    test("works alongside app.use(cors()) for actual responses", async () => {
      const router = new HTTPRouter();
      // preflightContinue: true so app.use(cors()) sets headers but doesn't
      // short-circuit OPTIONS — letting the cors.preflight() handler run.
      router.use(
        cors({
          origin: "https://app.example.com",
          credentials: true,
          preflightContinue: true,
        }),
      );
      router.options(
        "*",
        cors.preflight({
          origin: "https://app.example.com",
          credentials: true,
          maxAge: 86400,
        }),
      );
      router.get("/", (ctx) => ctx.json({ ok: true }));

      // Preflight
      const pre = await runFetch(
        router,
        createMockReq("http://localhost/", "OPTIONS", {
          Origin: "https://app.example.com",
        }),
      );
      expect(pre.status).toBe(204);
      expect(pre.headers.get("Access-Control-Max-Age")).toBe("86400");

      // Actual
      const actual = await runFetch(
        router,
        createMockReq("http://localhost/", "GET", {
          Origin: "https://app.example.com",
        }),
      );
      expect(actual.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.example.com",
      );
      expect(await actual.json()).toEqual({ ok: true });
    });
  });

  // ─── app.use(cors()) on unmatched requests ─────────────────
  // No OPTIONS routes: preflights resolve to 404/405, and the router must
  // still run app-level middleware before its fallback response.
  describe("unmatched requests (no OPTIONS route)", () => {
    function appWithRoutes(options?: CorsOptions): Sinwan {
      const app = new Sinwan();
      app.use(cors(options));
      app.get("/", (ctx) => ctx.json({ ok: true }));
      app.post("/api/hello", (ctx) => ctx.json({ hello: true }));
      return app;
    }

    const preflightHeaders = {
      Origin: "http://localhost:3000",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type",
    };

    test("preflight on a POST-only route returns 204 with CORS headers", async () => {
      const app = appWithRoutes({
        origin: "http://localhost:3000",
        methods: ["GET", "POST"],
      });
      const res = await app.request("/api/hello", {
        method: "OPTIONS",
        headers: preflightHeaders,
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("Allow")).toBe(null);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "http://localhost:3000",
      );
      expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET,POST");
      expect(res.headers.get("Access-Control-Allow-Headers")).toBe(
        "Content-Type",
      );
      expect(res.headers.get("Vary")).toBe(
        "Origin, Access-Control-Request-Headers",
      );
      expect(await res.text()).toBe("");
    });

    test("preflight on a GET-only route returns 204 with CORS headers", async () => {
      const app = appWithRoutes();
      const res = await app.request("/", {
        method: "OPTIONS",
        headers: preflightHeaders,
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Methods")).toBe(
        "GET,HEAD,PUT,PATCH,POST,DELETE,QUERY",
      );
      expect(res.headers.get("Access-Control-Allow-Headers")).toBe(
        "Content-Type",
      );
    });

    test("preflight on an unknown path returns 204", async () => {
      const app = appWithRoutes();
      const res = await app.request("/nope", {
        method: "OPTIONS",
        headers: preflightHeaders,
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    test("GET on an unknown path keeps the 404 body and adds CORS headers", async () => {
      const app = appWithRoutes({ origin: "http://localhost:3000" });
      const res = await app.request("/nope", {
        headers: { Origin: "http://localhost:3000" },
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "Not Found", path: "/nope" });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "http://localhost:3000",
      );
      expect(res.headers.get("Vary")).toBe("Origin");
    });

    test("wrong method keeps the 405 + Allow and adds CORS headers", async () => {
      const app = appWithRoutes();
      const res = await app.request("/api/hello", {
        method: "DELETE",
        headers: { Origin: "https://x.com" },
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(await res.json()).toEqual({ error: "Method Not Allowed" });
    });

    test("disallowed origin (array) gets no Access-Control-Allow-Origin", async () => {
      const app = appWithRoutes({ origin: ["https://a.com", "https://b.com"] });
      const res = await app.request("/api/hello", {
        method: "OPTIONS",
        headers: { ...preflightHeaders, Origin: "https://evil.com" },
      });
      // cors still short-circuits, but without granting the origin.
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(null);
      expect(res.headers.get("Vary")).toContain("Origin");
    });

    test("preflightContinue: true falls through to the 405 with CORS headers", async () => {
      const app = appWithRoutes({ preflightContinue: true });
      const res = await app.request("/api/hello", {
        method: "OPTIONS",
        headers: preflightHeaders,
      });
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("POST");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Methods")).toBe(
        "GET,HEAD,PUT,PATCH,POST,DELETE,QUERY",
      );
    });

    test("dynamic options delegate (async) still short-circuits", async () => {
      const app = new Sinwan();
      app.use(
        cors((_ctx, cb) => {
          setTimeout(() => cb(null, { origin: "https://dyn.com" }), 1);
        }),
      );
      app.get("/", (ctx) => ctx.json({ ok: true }));
      const res = await app.request("/", {
        method: "OPTIONS",
        headers: preflightHeaders,
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://dyn.com",
      );
    });

    test("explicit cors.preflight route still handles preflights", async () => {
      const app = new Sinwan();
      app.options(
        "*",
        cors.preflight({ origin: "https://app.example.com", maxAge: 600 }),
      );
      app.post("/api/hello", (ctx) => ctx.json({ hello: true }));
      const res = await app.request("/api/hello", {
        method: "OPTIONS",
        headers: { ...preflightHeaders, Origin: "https://app.example.com" },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.example.com",
      );
      expect(res.headers.get("Access-Control-Max-Age")).toBe("600");
      expect(res.headers.get("Vary")).toBe(
        "Origin, Access-Control-Request-Headers",
      );
    });

    test("cors inside an HTTP module does not apply to unmatched paths", async () => {
      const app = new Sinwan();
      app.register(
        createHttpModule({
          prefix: "/api",
          routes: (router) => {
            router.use(cors());
            router.get("/users", (ctx) => ctx.json([]));
          },
        }),
      );
      const pre = await app.request("/api/users", {
        method: "OPTIONS",
        headers: preflightHeaders,
      });
      expect(pre.status).toBe(405);
      expect(pre.headers.get("Allow")).toBe("GET");
      expect(pre.headers.get("Access-Control-Allow-Origin")).toBe(null);

      const missing = await app.request("/api/nope");
      expect(missing.status).toBe(404);
      expect(missing.headers.get("Access-Control-Allow-Origin")).toBe(null);
    });
  });

  // ─── Vary de-duplication ───────────────────────────────────
  describe("Vary de-duplication", () => {
    test("does not duplicate Origin in Vary", async () => {
      // origin reflection adds Vary: Origin; allowedHeaders reflection adds
      // Vary: Access-Control-Request-Headers. Both should coexist without
      // duplicate Origin entries.
      const router = corsApp({ origin: ["https://a.com"] });
      const res = await runFetch(
        router,
        createMockReq("http://localhost/", "OPTIONS", {
          Origin: "https://a.com",
          "Access-Control-Request-Headers": "X-Custom",
        }),
      );
      const vary = res.headers.get("Vary") ?? "";
      const parts = vary.split(",").map((p) => p.trim().toLowerCase());
      const originCount = parts.filter((p) => p === "origin").length;
      expect(originCount).toBe(1);
      expect(parts).toContain("access-control-request-headers");
    });
  });
});
