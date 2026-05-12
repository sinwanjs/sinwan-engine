/**
 * SinwanJS Server — Hydration-Aware SSR Renderer
 *
 * Enhanced `renderToString` that injects hydration markers:
 *
 *   data-sjs-id="c0"             — component boundary
 *   <!--sjs-t:0-->val<!--/sjs-t-->  — reactive text boundary
 *   data-sjs-ev="click:0"        — event binding reference
 *
 * Usage:
 *   const html = await renderToHydratableString(App, { name: "World" });
 *   // → '<div data-sjs-id="c0"><p>Count: <!--sjs-t:0-->5<!--/sjs-t--></p>...</div>'
 */

import type { SjsElement, SjsNode, SjsComponent } from "../view/types.ts";
import { HtmlEscapedString, escapeHtml } from "../view/escaper.ts";
import { isSignal } from "../client/reactivity/signal.ts";
import { isComputed } from "../client/reactivity/computed.ts";
import {
  compId,
  textMarkerOpen,
  textMarkerCloseStr,
  COMP_ID_ATTR,
  EVENT_ATTR,
} from "../client/hydration/markers.ts";
import { isEventProp, toEventName } from "../client/renderer/events.ts";
import {
  createComponentInstance,
  setCurrentInstance,
} from "../client/component/instance.ts";

// ─── Hydration context ─────────────────────────────────────

interface HydrationContext {
  componentIndex: number;
  textIndex: number;
  eventIndex: number;
}

function createHydrationContext(): HydrationContext {
  return { componentIndex: 0, textIndex: 0, eventIndex: 0 };
}

// ─── Public API ────────────────────────────────────────────

/**
 * Render a component to an HTML string with hydration markers.
 */
export async function renderToHydratableString(
  component: SjsComponent<any>,
  props?: Record<string, unknown>,
): Promise<string> {
  const ctx = createHydrationContext();
  const mergedProps = props ?? {};

  // Create a temporary instance so lifecycle hooks register silently
  const instance = createComponentInstance(component, mergedProps, null);
  setCurrentInstance(instance);

  // Call the component to get the element tree
  const result = await component(mergedProps);

  setCurrentInstance(null);

  if (result && typeof result === "object" && "tag" in result) {
    return renderElementH(result, ctx, true /* isComponentRoot */);
  }

  return renderNodeH(result as SjsNode, ctx);
}

/**
 * Render a raw SjsNode tree with hydration markers.
 */
export async function renderNodeToHydratableString(
  node: SjsNode,
): Promise<string> {
  const ctx = createHydrationContext();
  return renderNodeH(node, ctx);
}

// ─── Internal rendering ────────────────────────────────────

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
 * Render a node with hydration markers.
 */
function renderNodeH(node: SjsNode, ctx: HydrationContext): string {
  if (node == null || typeof node === "boolean") return "";

  if (typeof node === "string") return escapeHtml(node);
  if (typeof node === "number") return String(node);

  if (node instanceof HtmlEscapedString) return node.value;

  // Signal or Computed → wrap with text markers
  if (isSignal(node) || isComputed(node)) {
    const value = (node as any).value;
    const idx = ctx.textIndex++;
    return `${textMarkerOpen(idx)}${escapeHtml(String(value))}${textMarkerCloseStr()}`;
  }

  if (Array.isArray(node)) {
    return node.map((child) => renderNodeH(child, ctx)).join("");
  }

  if (node instanceof Promise) {
    // Sync-only for hydration SSR — await should be handled at top level
    return "";
  }

  if (typeof node === "object" && "tag" in node) {
    return renderElementH(node, ctx, false);
  }

  return escapeHtml(String(node));
}

/**
 * Render an element with hydration markers.
 */
function renderElementH(
  element: SjsElement,
  ctx: HydrationContext,
  isComponentRoot: boolean,
): string {
  const { tag, props, children } = element;

  // Fragment
  if (tag === "") {
    return children.map((child) => renderNodeH(child, ctx)).join("");
  }

  // Functional component
  if (typeof tag === "function") {
    return renderComponentH(tag, props, ctx);
  }

  // Intrinsic HTML element
  if (typeof tag === "string") {
    return renderIntrinsicH(tag, props, children, ctx, isComponentRoot);
  }

  return children.map((child) => renderNodeH(child, ctx)).join("");
}

/**
 * Render a functional component — calls it and marks the root element.
 */
function renderComponentH(
  component: Function,
  props: Record<string, unknown>,
  ctx: HydrationContext,
): string {
  // Set a temporary instance for lifecycle hooks
  const parentInstance = (globalThis as any).__sjsCurrentInstance;
  const instance = createComponentInstance(component as any, props, null);
  const prev = setCurrentInstance(instance);

  const result = component(props);

  setCurrentInstance(prev);

  if (result && typeof result === "object" && "tag" in result) {
    return renderElementH(
      result as SjsElement,
      ctx,
      true /* mark as component root */,
    );
  }

  return renderNodeH(result as SjsNode, ctx);
}

/**
 * Render an intrinsic element with hydration markers.
 */
function renderIntrinsicH(
  tag: string,
  props: Record<string, unknown>,
  children: SjsNode[],
  ctx: HydrationContext,
  isComponentRoot: boolean,
): string {
  let attrs = "";

  // Component boundary marker
  if (isComponentRoot) {
    attrs += ` ${COMP_ID_ATTR}="${compId(ctx.componentIndex++)}"`;
  }

  // Event markers + regular attributes
  const eventParts: string[] = [];

  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || key === "dangerouslySetInnerHTML") continue;

    if (isEventProp(key)) {
      // Collect event markers
      const eventName = toEventName(key);
      eventParts.push(`${eventName}:${ctx.eventIndex++}`);
      continue;
    }

    if (value == null || value === false) continue;

    // Resolve signal/computed values to their current values for SSR
    let resolvedValue = value;
    if (isSignal(value) || isComputed(value)) {
      resolvedValue = (value as any).value;
    }

    if (resolvedValue === true) {
      const attrName =
        key === "className" ? "class" : key === "htmlFor" ? "for" : key;
      attrs += ` ${attrName}`;
      continue;
    }

    const attrName =
      key === "className" ? "class" : key === "htmlFor" ? "for" : key;
    attrs += ` ${attrName}="${escapeHtml(String(resolvedValue))}"`;
  }

  // Add event attribute
  if (eventParts.length > 0) {
    attrs += ` ${EVENT_ATTR}="${eventParts.join(",")}"`;
  }

  // Void elements
  if (VOID_ELEMENTS.has(tag)) {
    return `<${tag}${attrs}>`;
  }

  // Dangerous inner HTML
  const dangerous = props.dangerouslySetInnerHTML as
    | { __html?: string }
    | undefined;
  if (dangerous && typeof dangerous.__html === "string") {
    return `<${tag}${attrs}>${dangerous.__html}</${tag}>`;
  }

  // Render children with markers
  const childrenHtml = children
    .map((child) => renderNodeH(child, ctx))
    .join("");

  return `<${tag}${attrs}>${childrenHtml}</${tag}>`;
}
