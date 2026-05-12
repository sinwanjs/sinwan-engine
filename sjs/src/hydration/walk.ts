/// <reference lib="dom" />

/**
 * SinwanJS Hydration — DOM Walker
 *
 * Walks existing server-rendered DOM and matches it against the
 * virtual SjsElement tree. Instead of creating new nodes, it
 * discovers existing ones and attaches reactivity to them.
 */

import type { SjsElement, SjsNode } from "../types.ts";
import type { MountedNode } from "../renderer/types.ts";
import type { CleanupFn } from "../reactivity/index.ts";
import { isSignal } from "../reactivity/signal.ts";
import { isComputed } from "../reactivity/computed.ts";
import { effect } from "../reactivity/effect.ts";
import { bindEvents, isEventProp } from "../renderer/events.ts";
import { applyAttributes } from "../renderer/attributes.ts";
import { HtmlEscapedString } from "../jsx/jsx-runtime.ts";
import {
  parseTextOpenMarker,
  isTextCloseMarker,
  COMP_ID_ATTR,
} from "./markers.ts";
import {
  createComponentInstance,
  getCurrentInstance,
  setCurrentInstance,
  fireMountedHooks,
  handleComponentError,
} from "../component/instance.ts";

/**
 * Hydration cursor — tracks our position in the DOM tree walk.
 */
export interface HydrationCursor {
  /** The parent node we are walking inside. */
  parent: Node;
  /** The next child node to process (null = exhausted). */
  current: Node | null;
}

/**
 * Advance the cursor to the next sibling.
 */
export function advance(cursor: HydrationCursor): Node | null {
  const node = cursor.current;
  if (node) {
    cursor.current = node.nextSibling;
  }
  return node;
}

// ─── Hydrate node ──────────────────────────────────────────

/**
 * Hydrate a single SjsNode by walking existing DOM.
 * Does NOT create new nodes — reuses server-rendered ones.
 */
export function hydrateNode(
  node: SjsNode,
  cursor: HydrationCursor,
): MountedNode {
  // null/undefined/boolean → skip empty text node
  if (node == null || typeof node === "boolean") {
    const textNode = advance(cursor) as Text;
    return { type: "text", node: textNode ?? document.createTextNode("") };
  }

  // String
  if (typeof node === "string") {
    const textNode = advance(cursor) as Text;
    return { type: "text", node: textNode };
  }

  // Number
  if (typeof node === "number") {
    const textNode = advance(cursor) as Text;
    return { type: "text", node: textNode };
  }

  // Pre-escaped HTML
  if (node instanceof HtmlEscapedString) {
    const textNode = advance(cursor) as Text;
    return { type: "text", node: textNode };
  }

  // Signal / Computed → reactive text with marker comments
  if (isSignal(node) || isComputed(node)) {
    return hydrateReactiveText(node as any, cursor);
  }

  // Array → hydrate each child
  if (Array.isArray(node)) {
    return hydrateArray(node, cursor);
  }

  // SjsElement
  if (typeof node === "object" && node !== null && "tag" in node) {
    return hydrateElement(node as SjsElement, cursor);
  }

  // Fallback — skip a text node
  const textNode = advance(cursor) as Text;
  return { type: "text", node: textNode };
}

// ─── Reactive text hydration ──────────────────────────────

/**
 * Hydrate a reactive text slot.
 * Expects: <!--sjs-t:N-->{text}<!--/sjs-t--> in the DOM.
 * Attaches an effect to update the text node when the signal changes.
 */
function hydrateReactiveText(
  reactive: { value: unknown },
  cursor: HydrationCursor,
): MountedNode {
  const openComment = cursor.current;

  // Try to find marker pattern: open comment → text → close comment
  if (
    openComment &&
    openComment.nodeType === 8 /* COMMENT_NODE */ &&
    parseTextOpenMarker(openComment as Comment) >= 0
  ) {
    // Skip the opening marker
    advance(cursor);

    // The text node
    const textNode = advance(cursor) as Text;

    // Skip the closing marker
    const closeComment = cursor.current;
    if (
      closeComment &&
      closeComment.nodeType === 8 &&
      isTextCloseMarker(closeComment as Comment)
    ) {
      advance(cursor);
    }

    // Attach reactive effect
    const dispose = effect(() => {
      textNode.data = String(reactive.value);
    });

    return { type: "reactive-text", node: textNode, dispose };
  }

  // Fallback: no markers — just treat as a regular text node
  const textNode = advance(cursor) as Text;
  if (textNode) {
    const dispose = effect(() => {
      textNode.data = String(reactive.value);
    });
    return { type: "reactive-text", node: textNode, dispose };
  }

  // Last resort
  const newText = document.createTextNode(String(reactive.value));
  const dispose = effect(() => {
    newText.data = String(reactive.value);
  });
  return { type: "reactive-text", node: newText, dispose };
}

// ─── Element hydration ────────────────────────────────────

/**
 * Hydrate an SjsElement against existing DOM.
 */
export function hydrateElement(
  element: SjsElement,
  cursor: HydrationCursor,
): MountedNode {
  const { tag, props, children } = element;

  // Fragment — hydrate children in place
  if (tag === "") {
    return hydrateArray(children, cursor);
  }

  // Functional component
  if (typeof tag === "function") {
    return hydrateComponent(tag, props, cursor);
  }

  // Intrinsic HTML element
  if (typeof tag === "string") {
    return hydrateIntrinsic(tag, props, children, cursor);
  }

  return hydrateArray(children, cursor);
}

/**
 * Hydrate an intrinsic HTML element.
 * Reuses the existing DOM element, attaches events and reactive attributes.
 */
function hydrateIntrinsic(
  tag: string,
  props: Record<string, unknown>,
  children: SjsNode[],
  cursor: HydrationCursor,
): MountedNode {
  const el = advance(cursor) as Element;

  if (!el || el.nodeType !== 1 /* ELEMENT_NODE */) {
    // Mismatch — fallback: walk already consumed node
    console.warn(`[SJS hydration] expected <${tag}> but found`, el);
    return { type: "text", node: document.createTextNode("") };
  }

  // Remove hydration-specific attributes
  el.removeAttribute(COMP_ID_ATTR);
  el.removeAttribute("data-sjs-ev");

  // Attach reactive attributes (signals in props)
  const attrDisposers = hydrateAttributes(el, props);

  // Attach event handlers
  const eventCleanups = bindEvents(el, props);

  // Hydrate children
  const childCursor: HydrationCursor = {
    parent: el,
    current: el.firstChild,
  };

  const mountedChildren: MountedNode[] = [];
  for (const child of children) {
    mountedChildren.push(hydrateNode(child, childCursor));
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
 * Hydrate attributes — only attach effects for reactive (signal/computed) props.
 * Static attributes are already correct from SSR.
 */
function hydrateAttributes(
  el: Element,
  props: Record<string, unknown>,
): CleanupFn[] {
  const disposers: CleanupFn[] = [];

  for (const [key, value] of Object.entries(props)) {
    if (
      key === "children" ||
      key === "key" ||
      key === "ref" ||
      isEventProp(key)
    )
      continue;

    if (isSignal(value) || isComputed(value)) {
      // Reactive attribute — needs an effect
      const dispose = effect(() => {
        const v = (value as any).value;
        const attrName =
          key === "className" ? "class" : key === "htmlFor" ? "for" : key;
        if (v == null || v === false) {
          el.removeAttribute(attrName);
        } else if (v === true) {
          el.setAttribute(attrName, "");
        } else {
          el.setAttribute(attrName, String(v));
        }
      });
      disposers.push(dispose);
    }
    // Static attributes: already rendered by SSR — skip
  }

  return disposers;
}

/**
 * Hydrate a functional component.
 * Creates a ComponentInstance, runs setup, then hydrates the returned tree.
 */
function hydrateComponent(
  component: Function,
  props: Record<string, unknown>,
  cursor: HydrationCursor,
): MountedNode {
  const parentInstance = getCurrentInstance();
  const instance = createComponentInstance(
    component as any,
    props,
    parentInstance,
  );

  if (parentInstance) {
    parentInstance.children.push(instance);
  }

  const prevInstance = setCurrentInstance(instance);

  let result: any;
  let child: MountedNode;

  try {
    result = component(props);

    if (result && typeof result === "object" && "tag" in result) {
      child = hydrateElement(result as SjsElement, cursor);
    } else {
      child = hydrateNode(result as SjsNode, cursor);
    }
  } catch (err) {
    setCurrentInstance(prevInstance);
    handleComponentError(instance, err as Error);
    const textNode = advance(cursor) as Text;
    return {
      type: "component",
      children: [
        { type: "text", node: textNode ?? document.createTextNode("") },
      ],
      disposers: [],
      instance,
    };
  }

  setCurrentInstance(prevInstance);
  instance.element = child;

  return {
    type: "component",
    children: [child],
    disposers: instance.effects,
    instance,
  };
}

// ─── Array hydration ───────────────────────────────────────

/**
 * Hydrate an array of children.
 */
function hydrateArray(nodes: SjsNode[], cursor: HydrationCursor): MountedNode {
  const children: MountedNode[] = [];
  for (const child of nodes) {
    children.push(hydrateNode(child, cursor));
  }

  // Use a placeholder anchor
  const anchor = document.createComment("sjs-f");
  return { type: "fragment", children, anchor };
}
