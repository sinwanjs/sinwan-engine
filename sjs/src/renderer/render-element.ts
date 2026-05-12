/// <reference lib="dom" />

/**
 * SinwanJS Client Renderer — Element Rendering
 *
 * Converts SjsElement trees into live DOM nodes.
 * Handles intrinsic HTML elements, functional components, and fragments.
 */

import type { SjsElement, SjsNode } from "../types.ts";
import type { MountedNode, MountedElement, MountedComponent } from "./types.ts";
import { domOps } from "./dom-ops.ts";
import { applyAttributes } from "./attributes.ts";
import { bindEvents } from "./events.ts";
import { renderChildrenToDOM, renderNodeToDOM } from "./render-children.ts";
import { Fragment } from "../jsx/jsx-runtime.ts";
import {
  createComponentInstance,
  getCurrentInstance,
  setCurrentInstance,
  handleComponentError,
  type ComponentInstance,
} from "../component/instance.ts";

// Void elements — no children, self-closing
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
 * Render an SjsElement to DOM and insert into parent.
 */
export function renderElementToDOM(
  element: SjsElement,
  parent: Node,
  anchor: Node | null = null,
): MountedNode {
  const { tag, props, children } = element;

  // Fragment — render children directly into parent
  if (tag === "" || (tag as any) === Fragment) {
    return renderFragmentToDOM(children, parent, anchor);
  }

  // Functional component — call it and render the result
  if (typeof tag === "function") {
    return renderComponentToDOM(tag, props, parent, anchor);
  }

  // Intrinsic HTML element
  if (typeof tag === "string") {
    return renderIntrinsicToDOM(tag, props, children, parent, anchor);
  }

  // Fallback — render children
  return renderFragmentToDOM(children, parent, anchor);
}

/**
 * Render an intrinsic HTML element (<div>, <p>, <button>, etc.).
 */
function renderIntrinsicToDOM(
  tag: string,
  props: Record<string, unknown>,
  children: SjsNode[],
  parent: Node,
  anchor: Node | null,
): MountedElement {
  const el = domOps.createElement(tag);

  // Apply attributes (returns disposers for reactive attrs)
  const attrDisposers = applyAttributes(el, props);

  // Bind event handlers
  const eventCleanups = bindEvents(el, props);

  // Render children (unless void element)
  let mountedChildren: MountedNode[] = [];
  if (!VOID_ELEMENTS.has(tag)) {
    // Handle dangerouslySetInnerHTML
    const dangerous = props.dangerouslySetInnerHTML as
      | { __html?: string }
      | undefined;
    if (dangerous && typeof dangerous.__html === "string") {
      (el as HTMLElement).innerHTML = dangerous.__html;
    } else {
      mountedChildren = renderChildrenToDOM(children, el);
    }
  }

  // Insert into parent
  if (anchor) {
    domOps.insertBefore(parent, el, anchor);
  } else {
    domOps.appendChild(parent, el);
  }

  return {
    type: "element",
    node: el,
    children: mountedChildren,
    eventCleanups,
    attrDisposers,
  };
}

/**
 * Render a functional component.
 *
 * Creates a ComponentInstance, sets it as the active instance during
 * setup so lifecycle hooks (onMounted, etc.) register on it, then
 * renders the returned element tree.
 */
function renderComponentToDOM(
  component: Function,
  props: Record<string, unknown>,
  parent: Node,
  anchor: Node | null,
): MountedComponent {
  // Create instance with parent context
  const parentInstance = getCurrentInstance();
  const instance = createComponentInstance(
    component as any,
    props,
    parentInstance,
  );

  // Register as child of parent
  if (parentInstance) {
    parentInstance.children.push(instance);
  }

  // Set this instance as current during BOTH setup AND rendering,
  // so nested child components discover it as their parent.
  const prevInstance = setCurrentInstance(instance);

  let result: any;
  let child: MountedNode;

  try {
    result = component(props);

    // Render the returned element tree (still under this instance)
    if (result && typeof result === "object" && "tag" in result) {
      child = renderElementToDOM(result as SjsElement, parent, anchor);
    } else {
      child = renderNodeToDOM(result as SjsNode, parent, anchor);
    }
  } catch (err) {
    // Restore parent before error handling
    setCurrentInstance(prevInstance);
    handleComponentError(instance, err as Error);
    // Return empty placeholder on error
    const text = domOps.createTextNode("");
    if (anchor) {
      domOps.insertBefore(parent, text, anchor);
    } else {
      domOps.appendChild(parent, text);
    }
    return {
      type: "component",
      children: [{ type: "text", node: text }],
      disposers: [],
      instance,
    };
  }

  // Restore parent instance
  setCurrentInstance(prevInstance);

  instance.element = child;

  return {
    type: "component",
    children: [child],
    disposers: instance.effects,
    instance,
  };
}

/**
 * Render children as a fragment (no wrapper element).
 */
function renderFragmentToDOM(
  children: SjsNode[],
  parent: Node,
  anchor: Node | null,
): MountedNode {
  const anchorComment = domOps.createComment("sjs-f");
  if (anchor) {
    domOps.insertBefore(parent, anchorComment, anchor);
  } else {
    domOps.appendChild(parent, anchorComment);
  }

  const mounted: MountedNode[] = [];
  for (const child of children) {
    mounted.push(renderNodeToDOM(child, parent, anchor));
  }

  return { type: "fragment", children: mounted, anchor: anchorComment };
}
