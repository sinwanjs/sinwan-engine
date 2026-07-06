/**
 * SinwanJS Core Runtime — Internal Assets Handler
 *
 * Prepended step that intercepts well-known static asset paths
 * (favicon.ico, robots.txt, sitemap.xml, etc.) BEFORE user middleware runs.
 *
 * - Responds immediately and stops the pipeline for matched paths.
 * - Configurable via SinwanOptions.internalAssets.
 * - Dynamic: custom paths can be registered at runtime via app.internalAssets.register().
 */

import type { Context } from "./context/context";
import type { Plugin } from "./types";
import type { Runtime } from "./runtime";

export type AssetHandler = (ctx: Context) => void;

export interface AssetEntry {
  /** The URL pathname to match (e.g. "/favicon.ico"). */
  path: string;
  /** Handler that sets a response on the context. */
  handler: AssetHandler;
}

export interface InternalAssetsOptions {
  /** Enable or disable default assets. Defaults to true. */
  enabled?: boolean;
  /** Provide a custom favicon (Buffer/Uint8Array). Set to false to disable. */
  favicon?: boolean | Uint8Array;
  /** Provide custom robots.txt content. Set to false to disable. */
  robots?: boolean | string;
  /** Provide custom security.txt content. Set to false to disable. */
  securityTxt?: boolean | string;
  /** Provide custom sitemap.xml content. Set to false to disable. */
  sitemap?: boolean | string;
  /** Provide custom manifest.json content. Set to false to disable. */
  manifest?: boolean | string;
  /** Additional custom assets to register. */
  custom?: AssetEntry[];
  /**
   * Paths to ignore (skip middleware but don't respond — let the router handle them).
   * Useful for devtools-injected files like /detector.js in Bun --hot mode.
   * Supports glob patterns (e.g. "/.well-known/*").
   */
  passthrough?: string[];
  /**
   * Path patterns to block with a clean 404 before middleware runs.
   * Supports glob patterns (e.g. "/.well-known/*").
   */
  blockPatterns?: string[];
}

function noopResponse(ctx: Context, status: number): void {
  ctx.setRawResponse(null, status);
  ctx.headers.set("Content-Length", "0");
}

function textResponse(
  ctx: Context,
  content: string,
  contentType: string,
  status = 200,
): void {
  ctx.setRawResponse(content, status, contentType);
}

function binaryResponse(
  ctx: Context,
  data: Uint8Array,
  contentType: string,
  status = 200,
): void {
  ctx.setRawResponse(data, status, contentType);
}

const DEFAULT_ROBOTS = "User-agent: *\nAllow: /\n";
const DEFAULT_SECURITY_TXT = "Contact: mailto:security@example.com\n";
const DEFAULT_SITEMAP =
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
const DEFAULT_MANIFEST = JSON.stringify(
  {
    name: "Sinwan App",
    short_name: "Sinwan",
    start_url: "/",
    display: "standalone",
  },
  null,
  2,
);

export class InternalAssets implements Plugin {
  public readonly name = "sinwan:internal-assets";

  private readonly assets = new Map<string, AssetHandler>();
  private readonly passthroughSet: Set<string>;
  private readonly passthroughPatterns: string[];
  private readonly blockPatternList: string[];

  constructor(options: InternalAssetsOptions = {}) {
    const {
      enabled = true,
      favicon = true,
      robots = true,
      securityTxt = true,
      sitemap = false,
      manifest = false,
      custom = [],
      passthrough = [],
      blockPatterns = [],
    } = options;

    this.passthroughSet = new Set<string>();
    this.passthroughPatterns = [];
    for (const p of passthrough) {
      if (p.includes("*")) this.passthroughPatterns.push(p);
      else this.passthroughSet.add(p);
    }
    this.blockPatternList = blockPatterns;

    if (!enabled) return;

    // favicon.ico
    if (favicon !== false) {
      const faviconData = favicon === true ? null : favicon;
      this.assets.set("/favicon.ico", (ctx) => {
        if (faviconData) {
          binaryResponse(ctx, faviconData, "image/x-icon");
        } else {
          noopResponse(ctx, 204);
        }
      });
    }

    // robots.txt
    if (robots !== false) {
      const content = robots === true ? DEFAULT_ROBOTS : robots;
      this.assets.set("/robots.txt", (ctx) => {
        textResponse(ctx, content, "text/plain; charset=utf-8");
      });
    }

    // security.txt
    if (securityTxt !== false) {
      const content = securityTxt === true ? DEFAULT_SECURITY_TXT : securityTxt;
      this.assets.set("/.well-known/security.txt", (ctx) => {
        textResponse(ctx, content, "text/plain; charset=utf-8");
      });
    }

    // sitemap.xml
    if (sitemap !== false) {
      const content = sitemap === true ? DEFAULT_SITEMAP : sitemap;
      this.assets.set("/sitemap.xml", (ctx) => {
        textResponse(ctx, content, "application/xml; charset=utf-8");
      });
    }

    // manifest.json
    if (manifest !== false) {
      const content = manifest === true ? DEFAULT_MANIFEST : manifest;
      this.assets.set("/manifest.json", (ctx) => {
        textResponse(ctx, content, "application/manifest+json; charset=utf-8");
      });
    }

    // Custom assets
    for (const entry of custom) {
      this.assets.set(entry.path, entry.handler);
    }
  }

  /** Register a custom asset at runtime. */
  register(path: string, handler: AssetHandler): this {
    this.assets.set(path, handler);
    return this;
  }

  /** Unregister an asset. */
  unregister(path: string): this {
    this.assets.delete(path);
    return this;
  }

  /** Add a passthrough path (skips middleware, lets router handle it). */
  addPassthrough(path: string): this {
    if (path.includes("*")) this.passthroughPatterns.push(path);
    else this.passthroughSet.add(path);
    return this;
  }

  /** Add a block pattern (responds 404 before middleware runs). */
  addBlockPattern(pattern: string): this {
    this.blockPatternList.push(pattern);
    return this;
  }

  /** Check if a path is handled by internal assets. */
  has(path: string): boolean {
    return this.assets.has(path);
  }

  install(runtime: Runtime): void {
    runtime.engine.prepend({
      name: "sinwan:internal-assets",
      run: (ctx: Context) => {
        // Skip for non-HTTP contexts
        if (ctx.tcp || ctx.udp || ctx.grpc) return;

        const url = ctx.req.url;
        const protoIdx = url.indexOf("://");
        let start = 0;
        if (protoIdx !== -1) {
          start = url.indexOf("/", protoIdx + 3);
          if (start === -1) return;
        }

        let end = url.length;
        for (let i = start; i < url.length; i++) {
          const cc = url.charCodeAt(i);
          if (cc === 63 || cc === 35) {
            end = i;
            break;
          }
        }

        const pathname = url.slice(start, end) || "/";

        // Passthrough: skip all subsequent steps, let Bun handle it
        if (this.passthroughSet.has(pathname) || this.matchPattern(pathname)) {
          return { type: "stop" } as const;
        }

        // Asset match: respond and stop (takes priority over block patterns)
        const handler = this.assets.get(pathname);
        if (handler) {
          handler(ctx);
          return { type: "stop" } as const;
        }

        // Block patterns: respond 404 and stop
        if (this.blockPatternList.some((p) => this.matchGlob(pathname, p))) {
          ctx.setRawResponse(null, 404);
          return { type: "stop" } as const;
        }
      },
    });
  }

  private matchPattern(pathname: string): boolean {
    for (const pattern of this.passthroughPatterns) {
      if (this.matchGlob(pathname, pattern)) return true;
    }
    return false;
  }

  private matchGlob(pathname: string, pattern: string): boolean {
    const prefix = pattern.slice(0, pattern.indexOf("*"));
    if (!prefix) return false;
    return pathname.startsWith(prefix);
  }
}
