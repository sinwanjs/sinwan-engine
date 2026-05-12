/// <reference lib="dom" />

/**
 * SinwanJS Client Renderer — Event Binding
 *
 * Direct event binding (not delegation). Each handler is attached
 * directly to its target element for simplicity and easy hydration.
 *
 * Design decision: direct binding like Solid.js, not delegation like React.
 */

import { domOps } from "./dom-ops.ts";
import type { CleanupFn } from "../reactivity/index.ts";

/**
 * Check if a prop key is an event handler (starts with "on").
 */
export function isEventProp(key: string): boolean {
  return key.length > 2 && key[0] === "o" && key[1] === "n" && key[2]! >= "A" && key[2]! <= "Z";
}

/**
 * Extract the DOM event name from a prop key.
 * e.g., "onClick" → "click", "onMouseEnter" → "mouseenter"
 */
export function toEventName(key: string): string {
  return key.slice(2).toLowerCase();
}

/**
 * Bind an event handler to an element.
 * Returns a cleanup function to remove the listener.
 */
export function bindEvent(
  el: Element,
  eventName: string,
  handler: EventListener,
): CleanupFn {
  domOps.addEventListener(el, eventName, handler);
  return () => {
    domOps.removeEventListener(el, eventName, handler);
  };
}

/**
 * Bind all event props from an element's props object.
 * Returns an array of cleanup functions.
 */
export function bindEvents(
  el: Element,
  props: Record<string, unknown>,
): CleanupFn[] {
  const cleanups: CleanupFn[] = [];

  for (const key of Object.keys(props)) {
    if (isEventProp(key)) {
      const handler = props[key];
      if (typeof handler === "function") {
        const eventName = toEventName(key);
        cleanups.push(bindEvent(el, eventName, handler as EventListener));
      }
    }
  }

  return cleanups;
}
