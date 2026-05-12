/// <reference lib="dom" />

/**
 * SinwanJS Client Renderer — Child Rendering
 *
 * Renders SjsNode children to DOM nodes. Handles primitives,
 * elements, arrays, signals, and fragments.
 */

import type { SjsNode } from "../types.ts";
import type { MountedNode } from "./types.ts";
import { domOps } from "./dom-ops.ts";
import { isSignal } from "../reactivity/signal.ts";
import { isComputed } from "../reactivity/computed.ts";
import { effect } from "../reactivity/effect.ts";
import { renderElementToDOM } from "./render-element.ts";
import { HtmlEscapedString } from "../jsx/jsx-runtime.ts";

/**
 * Render a single SjsNode to DOM and append to parent.
 * Returns the MountedNode descriptor for cleanup/unmount.
 */
export function renderNodeToDOM(
  node: SjsNode,
  parent: Node,
  anchor: Node | null = null,
): MountedNode {
  // null/undefined/boolean → empty text node (placeholder)
  if (node == null || typeof node === "boolean") {
    const text = domOps.createTextNode("");
    insertNode(parent, text, anchor);
    return { type: "text", node: text };
  }

  // String
  if (typeof node === "string") {
    const text = domOps.createTextNode(node);
    insertNode(parent, text, anchor);
    return { type: "text", node: text };
  }

  // Number
  if (typeof node === "number") {
    const text = domOps.createTextNode(String(node));
    insertNode(parent, text, anchor);
    return { type: "text", node: text };
  }

  // Pre-escaped HTML string
  if (node instanceof HtmlEscapedString) {
    const text = domOps.createTextNode(node.value);
    insertNode(parent, text, anchor);
    return { type: "text", node: text };
  }

  // Signal or Computed → reactive text node
  if (isSignal(node) || isComputed(node)) {
    const text = domOps.createTextNode(String(node.value));
    insertNode(parent, text, anchor);
    const dispose = effect(() => {
      domOps.setTextContent(text, String((node as any).value));
    });
    return { type: "reactive-text", node: text, dispose };
  }

  // Array → fragment
  if (Array.isArray(node)) {
    return renderArrayToDOM(node, parent, anchor);
  }

  // Promise → placeholder (resolved async)
  if (node instanceof Promise) {
    const placeholder = domOps.createTextNode("");
    insertNode(parent, placeholder, anchor);
    // TODO: async component support (Phase 3+)
    node.then((resolved) => {
      const mounted = renderNodeToDOM(resolved, parent, placeholder);
      domOps.remove(placeholder);
    });
    return { type: "text", node: placeholder };
  }

  // SjsElement
  if (typeof node === "object" && "tag" in node) {
    return renderElementToDOM(node, parent, anchor);
  }

  // Fallback — coerce to string
  const text = domOps.createTextNode(String(node));
  insertNode(parent, text, anchor);
  return { type: "text", node: text };
}

/**
 * Render an array of children to DOM as a fragment.
 */
function renderArrayToDOM(
  nodes: SjsNode[],
  parent: Node,
  anchor: Node | null,
): MountedNode {
  const anchorComment = domOps.createComment("sjs-f");
  insertNode(parent, anchorComment, anchor);

  const children: MountedNode[] = [];
  for (const child of nodes) {
    children.push(renderNodeToDOM(child, parent, anchor));
  }

  return { type: "fragment", children, anchor: anchorComment };
}

/**
 * Render multiple children into a parent element.
 * Returns array of MountedNode descriptors.
 */
export function renderChildrenToDOM(
  children: SjsNode[],
  parent: Node,
): MountedNode[] {
  const mounted: MountedNode[] = [];
  for (const child of children) {
    mounted.push(renderNodeToDOM(child, parent));
  }
  return mounted;
}

/**
 * Insert a node into parent, optionally before an anchor.
 */
function insertNode(parent: Node, child: Node, anchor: Node | null): void {
  if (anchor) {
    domOps.insertBefore(parent, child, anchor);
  } else {
    domOps.appendChild(parent, child);
  }
}
