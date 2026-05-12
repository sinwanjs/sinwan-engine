/**
 * SinwanJS View Module — Context Extension
 *
 * Extends the core Context class with view rendering methods.
 * This module provides the integration between the view system
 * and the request context.
 */

import type { Context } from "../context";
import type { SjsPage } from "./types";
import { renderPage, registerPage, getPage } from "./renderer";
import { streamPage } from "./stream";

/**
 * Methods added to Context for view rendering.
 * These are mixed into Context via declaration merging.
 */
export interface ViewContextMethods {
  /**
   * Register a page renderer with the application.
   * @param name - Unique identifier for the page
   * @param page - The page component to register
   *
   * @example
   * const HomePage = sjs.createPage<HomeData>((data) => (
   *   <Layout><h1>{data.title}</h1></Layout>
   * ));
   * app.setRenderer("home", HomePage);
   */
  setRenderer<D extends object = {}>(name: string, page: SjsPage<D>): void;

  /**
   * Render a registered page to an HTML response.
   * @param name - The registered page name
   * @param data - Data object passed to the page
   * @returns Promise resolving when HTML is set as response
   *
   * @example
   * app.get("/", (c) => {
   *   return c.render("home", { title: "Welcome" });
   * });
   */
  render<D extends object = {}>(name: string, data: D): Promise<void>;

  /**
   * Stream a registered page as an HTML response.
   * Sends chunks progressively without waiting for full render.
   * @param name - The registered page name
   * @param data - Data object passed to the page
   * @returns void (immediately starts streaming)
   *
   * @example
   * app.get("/feed", (c) => {
   *   return c.streamRender("feed", { posts: fetchPosts() });
   * });
   */
  streamRender<D extends object = {}>(name: string, data: D): void;
}

/**
 * Implementation of view methods for Context.
 * These methods are bound to Context instances.
 */
export const viewContextImpl: ViewContextMethods = {
  setRenderer<D extends object = {}>(this: Context, name: string, page: SjsPage<D>): void {
    registerPage(name, page);
  },

  async render<D extends object = {}>(this: Context, name: string, data: D): Promise<void> {
    const html = await renderPage(name, data);
    this.html(html);
  },

  streamRender<D extends object = {}>(this: Context, name: string, data: D): void {
    const page = getPage<D>(name);
    if (!page) {
      throw new Error(`Page "${name}" not found in registry`);
    }

    const stream = streamPage(page, data);
    this.stream(stream, 200, "text/html; charset=UTF-8");
  },
};
