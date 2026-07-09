import { describe, expect, test, mock } from "bun:test";
import { InternalAssets, type AssetEntry } from "../src/internal-assets";
import type { Runtime } from "../src/runtime";
import type { EventBus } from "../src/event-bus";
import type { Context } from "../src/context/context";
import type { StepResult } from "../src/types";

function createMockContext(
  url: string,
  overrides: Partial<Context> = {},
): Context {
  return {
    req: { url } as unknown as Context["req"],
    tcp: undefined,
    udp: undefined,
    grpc: undefined,
    headers: new Headers(),
    setRawResponse: mock(() => {}),
    ...overrides,
  } as unknown as Context;
}

function createMockRuntime(): Runtime {
  const steps: {
    name: string;
    run: (ctx: Context, bus: EventBus) => unknown;
  }[] = [];
  const bus = {} as EventBus;
  return {
    engine: {
      prepend: (step: {
        name: string;
        run: (ctx: Context, bus: EventBus) => unknown;
      }) => {
        steps.unshift(step);
      },
      run: (ctx: Context): unknown => steps[0]?.run(ctx, bus),
    },
    bus,
    errorHandler: {} as unknown as Runtime["errorHandler"],
    use: () => {},
    fetch: () => new Response(),
    acquireContext: () => ({}) as Context,
    releaseContext: () => {},
  } as unknown as Runtime;
}

describe("InternalAssets", () => {
  // ─── Constructor ─────────────────────────────────────────

  describe("constructor", () => {
    test("creates with default options", () => {
      const assets = new InternalAssets();
      expect(assets.has("/favicon.ico")).toBe(true);
      expect(assets.has("/robots.txt")).toBe(true);
      expect(assets.has("/.well-known/security.txt")).toBe(true);
      expect(assets.has("/sitemap.xml")).toBe(false);
      expect(assets.has("/manifest.json")).toBe(false);
    });

    test("creates with all defaults enabled", () => {
      const assets = new InternalAssets({
        favicon: true,
        robots: true,
        securityTxt: true,
        sitemap: true,
        manifest: true,
      });
      expect(assets.has("/favicon.ico")).toBe(true);
      expect(assets.has("/robots.txt")).toBe(true);
      expect(assets.has("/.well-known/security.txt")).toBe(true);
      expect(assets.has("/sitemap.xml")).toBe(true);
      expect(assets.has("/manifest.json")).toBe(true);
    });

    test("creates with everything disabled", () => {
      const assets = new InternalAssets({ enabled: false });
      expect(assets.has("/favicon.ico")).toBe(false);
      expect(assets.has("/robots.txt")).toBe(false);
      expect(assets.has("/.well-known/security.txt")).toBe(false);
    });

    test("disables favicon with false", () => {
      const assets = new InternalAssets({ favicon: false });
      expect(assets.has("/favicon.ico")).toBe(false);
    });

    test("disables robots with false", () => {
      const assets = new InternalAssets({ robots: false });
      expect(assets.has("/robots.txt")).toBe(false);
    });

    test("disables securityTxt with false", () => {
      const assets = new InternalAssets({ securityTxt: false });
      expect(assets.has("/.well-known/security.txt")).toBe(false);
    });

    test("disables sitemap with false", () => {
      const assets = new InternalAssets({ sitemap: false });
      expect(assets.has("/sitemap.xml")).toBe(false);
    });

    test("disables manifest with false", () => {
      const assets = new InternalAssets({ manifest: false });
      expect(assets.has("/manifest.json")).toBe(false);
    });

    test("uses custom favicon data", () => {
      const faviconData = new Uint8Array([0x89, 0x50]);
      const assets = new InternalAssets({ favicon: faviconData });
      expect(assets.has("/favicon.ico")).toBe(true);
    });

    test("uses custom robots content", () => {
      const assets = new InternalAssets({ robots: "Disallow: /admin" });
      expect(assets.has("/robots.txt")).toBe(true);
    });

    test("uses custom securityTxt content", () => {
      const assets = new InternalAssets({
        securityTxt: "Contact: mailto:sec@test.com",
      });
      expect(assets.has("/.well-known/security.txt")).toBe(true);
    });

    test("uses custom sitemap content", () => {
      const assets = new InternalAssets({
        sitemap: "<urlset><url><loc>http://test.com</loc></url></urlset>",
      });
      expect(assets.has("/sitemap.xml")).toBe(true);
    });

    test("uses custom manifest content", () => {
      const assets = new InternalAssets({
        manifest: '{"name":"Custom"}',
      });
      expect(assets.has("/manifest.json")).toBe(true);
    });

    test("registers custom assets", () => {
      const custom: AssetEntry[] = [
        { path: "/custom.txt", handler: () => {} },
        { path: "/special.json", handler: () => {} },
      ];
      const assets = new InternalAssets({ custom });
      expect(assets.has("/custom.txt")).toBe(true);
      expect(assets.has("/special.json")).toBe(true);
    });

    test("registers passthrough paths (exact)", () => {
      const assets = new InternalAssets({
        passthrough: ["/detector.js"],
      });
      expect(assets).toBeDefined();
    });

    test("registers passthrough patterns (glob)", () => {
      const assets = new InternalAssets({
        passthrough: ["/.well-known/*"],
      });
      expect(assets).toBeDefined();
    });

    test("registers block patterns", () => {
      const assets = new InternalAssets({
        blockPatterns: ["/.well-known/*"],
      });
      expect(assets).toBeDefined();
    });
  });

  // ─── register / unregister ───────────────────────────────

  describe("register / unregister", () => {
    test("register adds a new asset", () => {
      const assets = new InternalAssets();
      expect(assets.has("/new.txt")).toBe(false);
      const result = assets.register("/new.txt", () => {});
      expect(result).toBe(assets);
      expect(assets.has("/new.txt")).toBe(true);
    });

    test("unregister removes an asset", () => {
      const assets = new InternalAssets();
      expect(assets.has("/favicon.ico")).toBe(true);
      const result = assets.unregister("/favicon.ico");
      expect(result).toBe(assets);
      expect(assets.has("/favicon.ico")).toBe(false);
    });

    test("unregister on non-existent path is safe", () => {
      const assets = new InternalAssets();
      expect(() => assets.unregister("/nonexistent")).not.toThrow();
    });
  });

  // ─── addPassthrough / addBlockPattern ────────────────────

  describe("addPassthrough / addBlockPattern", () => {
    test("addPassthrough with exact path", () => {
      const assets = new InternalAssets();
      const result = assets.addPassthrough("/exact.js");
      expect(result).toBe(assets);
    });

    test("addPassthrough with glob pattern", () => {
      const assets = new InternalAssets();
      const result = assets.addPassthrough("/glob/*");
      expect(result).toBe(assets);
    });

    test("addBlockPattern adds a pattern", () => {
      const assets = new InternalAssets();
      const result = assets.addBlockPattern("/blocked/*");
      expect(result).toBe(assets);
    });
  });

  // ─── has() ───────────────────────────────────────────────

  describe("has()", () => {
    test("returns true for registered asset", () => {
      const assets = new InternalAssets();
      expect(assets.has("/robots.txt")).toBe(true);
    });

    test("returns false for unregistered asset", () => {
      const assets = new InternalAssets();
      expect(assets.has("/nonexistent")).toBe(false);
    });
  });

  // ─── install / run step ──────────────────────────────────

  describe("install / run step", () => {
    test("install prepends step to engine", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets();
      assets.install(runtime);
      // Step should be prepended — verify by running a request
      const ctx = createMockContext("http://localhost/robots.txt");
      runtime.engine.run(ctx, runtime.bus);
      // If the step was installed, it should have called setRawResponse
      expect(ctx.setRawResponse).toHaveBeenCalled();
    });

    test("skips for TCP context", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets();
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/robots.txt", {
        tcp: {} as Context["tcp"],
      });
      const result = runtime.engine.run(ctx, runtime.bus);
      expect(result).toBeUndefined();
      expect(ctx.setRawResponse).not.toHaveBeenCalled();
    });

    test("skips for UDP context", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets();
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/robots.txt", {
        udp: {} as Context["udp"],
      });
      const result = runtime.engine.run(ctx, runtime.bus);
      expect(result).toBeUndefined();
      expect(ctx.setRawResponse).not.toHaveBeenCalled();
    });

    test("skips for gRPC context", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets();
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/robots.txt", {
        grpc: {} as Context["grpc"],
      });
      const result = runtime.engine.run(ctx, runtime.bus);
      expect(result).toBeUndefined();
      expect(ctx.setRawResponse).not.toHaveBeenCalled();
    });

    test("favicon.ico returns 204 by default", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets();
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/favicon.ico");
      const result = runtime.engine.run(
        ctx,
        runtime.bus,
      ) as unknown as StepResult;
      expect(result).toEqual({ type: "stop" });
      expect(ctx.setRawResponse).toHaveBeenCalledWith(null, 204);
    });

    test("favicon.ico with custom data returns binary", () => {
      const faviconData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const runtime = createMockRuntime();
      const assets = new InternalAssets({ favicon: faviconData });
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/favicon.ico");
      runtime.engine.run(ctx, runtime.bus);
      expect(ctx.setRawResponse).toHaveBeenCalledWith(
        faviconData,
        200,
        "image/x-icon",
      );
    });

    test("robots.txt returns text content", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets();
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/robots.txt");
      runtime.engine.run(ctx, runtime.bus);
      expect(ctx.setRawResponse).toHaveBeenCalledWith(
        "User-agent: *\nAllow: /\n",
        200,
        "text/plain; charset=utf-8",
      );
    });

    test("custom robots content is used", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets({ robots: "Disallow: /admin" });
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/robots.txt");
      runtime.engine.run(ctx, runtime.bus);
      expect(ctx.setRawResponse).toHaveBeenCalledWith(
        "Disallow: /admin",
        200,
        "text/plain; charset=utf-8",
      );
    });

    test("security.txt returns content", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets();
      assets.install(runtime);
      const ctx = createMockContext(
        "http://localhost/.well-known/security.txt",
      );
      runtime.engine.run(ctx, runtime.bus);
      expect(ctx.setRawResponse).toHaveBeenCalledWith(
        "Contact: mailto:security@example.com\n",
        200,
        "text/plain; charset=utf-8",
      );
    });

    test("custom securityTxt content is used", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets({
        securityTxt: "Contact: mailto:sec@test.com",
      });
      assets.install(runtime);
      const ctx = createMockContext(
        "http://localhost/.well-known/security.txt",
      );
      runtime.engine.run(ctx, runtime.bus);
      expect(ctx.setRawResponse).toHaveBeenCalledWith(
        "Contact: mailto:sec@test.com",
        200,
        "text/plain; charset=utf-8",
      );
    });

    test("sitemap.xml returns content", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets({ sitemap: true });
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/sitemap.xml");
      runtime.engine.run(ctx, runtime.bus);
      expect(ctx.setRawResponse).toHaveBeenCalledWith(
        expect.stringContaining("<urlset"),
        200,
        "application/xml; charset=utf-8",
      );
    });

    test("custom sitemap content is used", () => {
      const customSitemap =
        "<urlset><url><loc>http://test.com</loc></url></urlset>";
      const runtime = createMockRuntime();
      const assets = new InternalAssets({ sitemap: customSitemap });
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/sitemap.xml");
      runtime.engine.run(ctx, runtime.bus);
      expect(ctx.setRawResponse).toHaveBeenCalledWith(
        customSitemap,
        200,
        "application/xml; charset=utf-8",
      );
    });

    test("manifest.json returns content", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets({ manifest: true });
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/manifest.json");
      runtime.engine.run(ctx, runtime.bus);
      expect(ctx.setRawResponse).toHaveBeenCalledWith(
        expect.stringContaining("Sinwan App"),
        200,
        "application/manifest+json; charset=utf-8",
      );
    });

    test("custom manifest content is used", () => {
      const customManifest = '{"name":"Custom"}';
      const runtime = createMockRuntime();
      const assets = new InternalAssets({ manifest: customManifest });
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/manifest.json");
      runtime.engine.run(ctx, runtime.bus);
      expect(ctx.setRawResponse).toHaveBeenCalledWith(
        customManifest,
        200,
        "application/manifest+json; charset=utf-8",
      );
    });

    test("custom asset handler is called", () => {
      const runtime = createMockRuntime();
      let handlerCalled = false;
      const assets = new InternalAssets({
        custom: [
          {
            path: "/custom.txt",
            handler: (ctx) => {
              handlerCalled = true;
              ctx.setRawResponse("custom", 200, "text/plain");
            },
          },
        ],
      });
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/custom.txt");
      runtime.engine.run(ctx, runtime.bus);
      expect(handlerCalled).toBe(true);
    });

    test("passthrough exact path returns stop", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets({
        passthrough: ["/detector.js"],
      });
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/detector.js");
      const result = runtime.engine.run(
        ctx,
        runtime.bus,
      ) as unknown as StepResult;
      expect(result).toEqual({ type: "stop" });
      expect(ctx.setRawResponse).not.toHaveBeenCalled();
    });

    test("passthrough glob pattern returns stop", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets({
        passthrough: ["/.well-known/*"],
      });
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/.well-known/something");
      const result = runtime.engine.run(
        ctx,
        runtime.bus,
      ) as unknown as StepResult;
      expect(result).toEqual({ type: "stop" });
    });

    test("addPassthrough at runtime with exact path", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets();
      assets.addPassthrough("/runtime-passthrough.js");
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/runtime-passthrough.js");
      const result = runtime.engine.run(
        ctx,
        runtime.bus,
      ) as unknown as StepResult;
      expect(result).toEqual({ type: "stop" });
    });

    test("addPassthrough at runtime with glob pattern", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets();
      assets.addPassthrough("/runtime/*");
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/runtime/test");
      const result = runtime.engine.run(
        ctx,
        runtime.bus,
      ) as unknown as StepResult;
      expect(result).toEqual({ type: "stop" });
    });

    test("block pattern returns 404", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets({
        blockPatterns: ["/blocked/*"],
      });
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/blocked/path");
      const result = runtime.engine.run(
        ctx,
        runtime.bus,
      ) as unknown as StepResult;
      expect(result).toEqual({ type: "stop" });
      expect(ctx.setRawResponse).toHaveBeenCalledWith(null, 404);
    });

    test("addBlockPattern at runtime", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets();
      assets.addBlockPattern("/runtime-blocked/*");
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/runtime-blocked/path");
      const result = runtime.engine.run(
        ctx,
        runtime.bus,
      ) as unknown as StepResult;
      expect(result).toEqual({ type: "stop" });
      expect(ctx.setRawResponse).toHaveBeenCalledWith(null, 404);
    });

    test("asset match takes priority over block pattern", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets({
        blockPatterns: ["/favicon*"],
      });
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/favicon.ico");
      const result = runtime.engine.run(
        ctx,
        runtime.bus,
      ) as unknown as StepResult;
      expect(result).toEqual({ type: "stop" });
      // Should be 204 (favicon handler), not 404 (block pattern)
      expect(ctx.setRawResponse).toHaveBeenCalledWith(null, 204);
    });

    test("non-matching path returns undefined (no stop)", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets();
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/api/users");
      const result = runtime.engine.run(ctx, runtime.bus);
      expect(result).toBeUndefined();
    });

    test("relative URL (no protocol) works", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets();
      assets.install(runtime);
      const ctx = createMockContext("/robots.txt");
      runtime.engine.run(ctx, runtime.bus);
      expect(ctx.setRawResponse).toHaveBeenCalled();
    });

    test("URL with query string strips query", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets();
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/robots.txt?foo=bar");
      runtime.engine.run(ctx, runtime.bus);
      expect(ctx.setRawResponse).toHaveBeenCalled();
    });

    test("URL with hash fragment strips hash", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets();
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/robots.txt#section");
      runtime.engine.run(ctx, runtime.bus);
      expect(ctx.setRawResponse).toHaveBeenCalled();
    });

    test("URL with protocol but no path returns undefined", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets();
      assets.install(runtime);
      const ctx = createMockContext("http://localhost");
      const result = runtime.engine.run(ctx, runtime.bus);
      expect(result).toBeUndefined();
    });

    test("URL with empty pathname defaults to /", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets();
      assets.install(runtime);
      // URL like "http://localhost?" produces empty pathname -> "/"
      const ctx = createMockContext("http://localhost?");
      const result = runtime.engine.run(ctx, runtime.bus);
      // pathname becomes "/" which doesn't match any asset
      expect(result).toBeUndefined();
    });

    test("glob pattern with no prefix returns false", () => {
      const runtime = createMockRuntime();
      const assets = new InternalAssets({
        passthrough: ["*"],
      });
      assets.install(runtime);
      const ctx = createMockContext("http://localhost/anything");
      const result = runtime.engine.run(ctx, runtime.bus);
      // "*" has no prefix, so matchGlob returns false, so no passthrough
      expect(result).toBeUndefined();
    });
  });
});
