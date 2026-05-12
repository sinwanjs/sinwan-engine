/**
 * SinwanJS View Module — Public API
 *
 * JSX-based templating engine with zero runtime dependencies.
 * Compiles to optimized string builders with streaming support.
 *
 * @example
 * import { sjs } from "@sinwan/core";
 *
 * const Layout = sjs.createComponent<{ title: string }>(({ title, children }) => (
 *   <html>
 *     <head><title>{title}</title></head>
 *     <body>{children}</body>
 *   </html>
 * ));
 *
 * const HomePage = sjs.createPage<{ name: string }>(({ name }) => (
 *   <Layout title="Home">
 *     <h1>Hello {name}!</h1>
 *   </Layout>
 * ));
 *
 * app.setRenderer("home", HomePage);
 * app.get("/", (c) => c.render("home", { name: "World" }));
 */

// Core types
export type {
  SjsNode,
  SjsElement,
  SjsComponent,
  SjsPage,
  SjsLayout,
  SjsSlots,
  SjsPrimitive,
  RenderResult,
  PropsWithChildren,
  PropsWithSlots,
} from "./types";

// Component factories
export { createComponent, createPage, createLayout } from "./component";

// Renderer & registry
export {
  registerPage,
  getPage,
  hasPage,
  renderPage,
  renderToString,
  isSlots,
} from "./renderer";

// Streaming
export { streamPage } from "./stream";

// Escaping utilities
export { escapeHtml, safeHtml, isSafeHtml, HtmlEscapedString } from "./escaper";

// Context integration (for type augmentation)
export type { ViewContextMethods } from "./context-ext";

// JSX Runtime
export { jsx, jsxs, jsxDEV, Fragment, raw } from "./jsx/jsx-runtime";

/**
 * Convenience namespace for importing all view utilities.
 * Matches the `sjs` namespace referenced in documentation.
 */
export const sjs = {
  createComponent,
  createPage,
  createLayout,
  registerPage,
  getPage,
  hasPage,
  renderPage,
  renderToString,
  streamPage,
  escapeHtml,
  safeHtml,
  isSafeHtml,
  isSlots,
  jsx,
  jsxs,
  jsxDEV,
  Fragment,
  raw,
};

// Re-import for the namespace object
import { createComponent, createPage, createLayout } from "./component";

import {
  registerPage,
  getPage,
  hasPage,
  renderPage,
  renderToString,
  isSlots,
} from "./renderer";

import { streamPage } from "./stream";

import { escapeHtml, safeHtml, isSafeHtml, HtmlEscapedString } from "./escaper";

import { jsx, jsxs, jsxDEV, Fragment, raw } from "./jsx/jsx-runtime";
