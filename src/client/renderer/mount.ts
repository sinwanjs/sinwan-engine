/// <reference lib="dom" />

/**
 * SinwanJS Client Renderer — Mount
 *
 * Entry point for rendering a component tree into a DOM container.
 * Returns an AppInstance handle for unmounting.
 */

import type { SjsComponent, SjsNode, SjsElement } from "../../view/types.ts";
import type { AppInstance, MountedNode } from "./types.ts";
import { renderNodeToDOM } from "./render-children.ts";
import { renderElementToDOM } from "./render-element.ts";
import {
  createComponentInstance,
  setCurrentInstance,
  fireMountedHooks,
  fireUnmountedHooks,
  handleComponentError,
} from "../component/instance.ts";

/**
 * Mount a component into a DOM container.
 *
 * Creates a root ComponentInstance, runs setup with lifecycle hooks,
 * renders to DOM, then fires onMounted hooks (bottom-up).
 *
 * @example
 * const app = mount(Counter, document.getElementById("app")!, { initial: 0 });
 * // later...
 * app.unmount();
 */
export function mount(
  component: SjsComponent<any>,
  container: Element,
  props?: Record<string, unknown>,
): AppInstance {
  // Clear the container
  container.innerHTML = "";

  const mergedProps = props ?? {};

  // Create root component instance
  const instance = createComponentInstance(component, mergedProps, null);

  let result: any;
  let root: MountedNode;

  // Set instance as current for BOTH setup AND rendering,
  // so child components can discover their parent.
  setCurrentInstance(instance);

  try {
    result = component(mergedProps);

    if (result instanceof Promise) {
      // Async component — render placeholder, then swap
      const placeholder = document.createTextNode("");
      container.appendChild(placeholder);
      root = { type: "text", node: placeholder };

      result.then((resolved) => {
        container.innerHTML = "";
        setCurrentInstance(instance);
        root = renderElementToDOM(resolved, container);
        setCurrentInstance(null);
        instance.element = root;
        fireMountedHooks(instance);
      });
    } else if (result && typeof result === "object" && "tag" in result) {
      root = renderElementToDOM(result, container);
    } else {
      root = renderNodeToDOM(result as SjsNode, container);
    }
  } catch (err) {
    setCurrentInstance(null);
    handleComponentError(instance, err as Error);
    return {
      root: { type: "text", node: document.createTextNode("") },
      unmount() {},
    };
  }

  // Restore — no instance is current at the top level
  setCurrentInstance(null);

  instance.element = root;

  // Fire onMounted hooks (bottom-up: children first, then parent)
  fireMountedHooks(instance);

  return {
    root,
    unmount() {
      // Fire onUnmounted hooks and dispose all effects
      fireUnmountedHooks(instance);
      // Clean up DOM tree
      unmountNode(root);
      container.innerHTML = "";
    },
  };
}

/**
 * Render a raw SjsElement or SjsNode tree into a container.
 * Lower-level than mount() — doesn't call a component function.
 */
export function render(node: SjsNode, container: Element): AppInstance {
  container.innerHTML = "";

  const root = renderNodeToDOM(node, container);

  return {
    root,
    unmount() {
      unmountNode(root);
      container.innerHTML = "";
    },
  };
}

/**
 * Recursively unmount a node tree — disposes effects, removes events.
 */
export function unmountNode(node: MountedNode): void {
  switch (node.type) {
    case "text":
      // Nothing to clean up
      break;

    case "reactive-text":
      node.dispose();
      break;

    case "element":
      // Dispose reactive attributes
      for (const dispose of node.attrDisposers) {
        dispose();
      }
      // Remove event listeners
      for (const cleanup of node.eventCleanups) {
        cleanup();
      }
      // Unmount children
      for (const child of node.children) {
        unmountNode(child);
      }
      break;

    case "fragment":
      for (const child of node.children) {
        unmountNode(child);
      }
      break;

    case "reactive-block":
      node.dispose();
      for (const child of node.children) {
        unmountNode(child);
      }
      break;

    case "component":
      // Fire lifecycle hooks if there's a ComponentInstance
      if (node.instance) {
        fireUnmountedHooks(node.instance);
      } else {
        // No instance — just dispose manually registered effects
        for (const dispose of node.disposers) {
          dispose();
        }
      }
      for (const child of node.children) {
        unmountNode(child);
      }
      break;
  }
}
