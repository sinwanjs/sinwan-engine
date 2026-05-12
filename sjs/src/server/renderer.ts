/**
 * SinwanJS View Module — Renderer & Component Registry
 *
 * Renders SJS component trees to HTML strings.
 * Supports async components, caching, and streaming.
 */

import type {
  SjsNode,
  SjsElement,
  SjsComponent,
  SjsPage,
  SjsSlots,
} from "../types.ts";
import { HtmlEscapedString, escapeHtml } from "../escaper.ts";

// Component cache - maps component identity to render function
const componentCache = new WeakMap<SjsComponent<any>, boolean>();

// Page registry
const pageRegistry = new Map<string, SjsPage<any>>();

/**
 * Register a page renderer by name.
 */
export function registerPage<D extends object = {}>(
  name: string,
  page: SjsPage<D>,
): void {
  pageRegistry.set(name, page);
}

/**
 * Get a registered page by name.
 */
export function getPage<D extends object = {}>(
  name: string,
): SjsPage<D> | undefined {
  return pageRegistry.get(name);
}

/**
 * Check if a page is registered.
 */
export function hasPage(name: string): boolean {
  return pageRegistry.has(name);
}

/**
 * Render a registered page to an HTML string.
 */
export async function renderPage<D extends object = {}>(
  name: string,
  data: D,
): Promise<string> {
  const page = getPage<D>(name);
  if (!page) {
    throw new Error(`Page "${name}" not found in registry`);
  }

  const element = await page(data);
  return renderToString(element);
}

/**
 * Render a node tree to an HTML string.
 * Handles primitives, elements, components, and arrays.
 */
export async function renderToString(node: SjsNode): Promise<string> {
  // Handle null/undefined/boolean
  if (node == null || typeof node === "boolean") {
    return "";
  }

  // Handle strings (escape them)
  if (typeof node === "string") {
    return escapeHtml(node);
  }

  // Handle numbers
  if (typeof node === "number") {
    return String(node);
  }

  // Handle pre-escaped HTML
  if (node instanceof HtmlEscapedString) {
    return node.value;
  }

  // Handle arrays - render each child and concatenate
  if (Array.isArray(node)) {
    const results = await Promise.all(
      node.map((child) => renderToString(child)),
    );
    return results.join("");
  }

  // Handle promises (async components)
  if (node instanceof Promise) {
    return renderElement(await node);
  }

  // Handle elements
  return renderElement(node);
}

/**
 * Render an element to HTML string.
 */
async function renderElement(element: SjsElement): Promise<string> {
  const { tag, props, children } = element;

  // Handle functional components
  if (typeof tag === "function") {
    const result = await tag(props);
    return renderToString(result);
  }

  // Handle intrinsic HTML elements
  if (typeof tag === "string") {
    return renderIntrinsicElement(tag, props, children);
  }

  // Fallback - shouldn't happen with valid JSX
  return renderToString(children);
}

// Void elements that don't have closing tags
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Render an intrinsic HTML element.
 */
async function renderIntrinsicElement(
  tag: string,
  props: Record<string, unknown>,
  children: SjsNode[],
): Promise<string> {
  const attrs = renderAttributes(props);

  // Void elements have no children and no closing tag
  if (VOID_ELEMENTS.has(tag)) {
    return attrs ? `<${tag}${attrs}>` : `<${tag}>`;
  }

  // Render children (handles dangerouslySetInnerHTML)
  const childrenHtml = await renderChildren(children, props);

  // Build element
  return attrs
    ? `<${tag}${attrs}>${childrenHtml}</${tag}>`
    : `<${tag}>${childrenHtml}</${tag}>`;
}

/**
 * Render HTML attributes from props.
 */
function renderAttributes(props: Record<string, unknown>): string {
  let attrs = "";

  for (const [key, value] of Object.entries(props)) {
    // Skip children and special props
    if (key === "children") continue;

    // Skip null/undefined/false values
    if (value == null || value === false) continue;

    // Handle boolean true (just the attribute name)
    if (value === true) {
      attrs += ` ${key}`;
      continue;
    }

    // Handle dangerous HTML (trusted only)
    if (key === "dangerouslySetInnerHTML") {
      // This is handled during children rendering, not as an attribute
      continue;
    }

    // Handle className -> class
    const attrName = key === "className" ? "class" : key;

    // Handle htmlFor -> for
    const finalName = attrName === "htmlFor" ? "for" : attrName;

    // Escape the attribute value
    const attrValue = escapeHtml(String(value));
    attrs += ` ${finalName}="${attrValue}"`;
  }

  return attrs;
}

/**
 * Render children, with special handling for dangerouslySetInnerHTML.
 */
async function renderChildren(
  children: SjsNode[],
  props: Record<string, unknown>,
): Promise<string> {
  // Check for dangerous inner HTML
  const dangerous = props.dangerouslySetInnerHTML as
    | { __html?: string }
    | undefined;
  if (dangerous && typeof dangerous.__html === "string") {
    return dangerous.__html; // Trust the HTML (user explicitly marked safe)
  }

  return renderToString(children);
}

// Wire up dangerouslySetInnerHTML handling by patching renderIntrinsicElement
const originalRenderIntrinsic = renderIntrinsicElement;

/**
 * Check if children is a slots object (named slots).
 */
export function isSlots(children: unknown): children is SjsSlots {
  return (
    children != null &&
    typeof children === "object" &&
    !Array.isArray(children) &&
    !(children instanceof HtmlEscapedString)
  );
}
