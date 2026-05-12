/**
 * SinwanJS Client Renderer — Public API
 */

// Mount / unmount
export { mount, render, unmountNode } from "./mount.ts";

// Low-level rendering
export { renderNodeToDOM, renderChildrenToDOM } from "./render-children.ts";
export { renderElementToDOM } from "./render-element.ts";

// DOM operations (for custom renderers / testing)
export { domOps } from "./dom-ops.ts";
export type { DOMOps } from "./dom-ops.ts";

// Attribute & event helpers
export { applyAttributes } from "./attributes.ts";
export { bindEvents, bindEvent, isEventProp, toEventName } from "./events.ts";

// Types
export type {
  MountedNode,
  MountedText,
  MountedReactiveText,
  MountedElement,
  MountedFragment,
  MountedReactiveBlock,
  MountedComponent,
  AppInstance,
} from "./types.ts";
