/// <reference lib="dom" />

/**
 * SinwanJS Client Renderer — Attribute Handling
 *
 * Maps JSX props to DOM attributes and properties.
 * Handles special cases: className→class, htmlFor→for,
 * style objects, boolean attributes, and reactive attributes.
 */

import { domOps } from "./dom-ops.ts";
import { isEventProp } from "./events.ts";
import { isSignal } from "../reactivity/signal.ts";
import { isComputed } from "../reactivity/computed.ts";
import { effect } from "../reactivity/effect.ts";
import type { CleanupFn } from "../reactivity/index.ts";

// Props that should be skipped during attribute rendering
const SKIP_PROPS = new Set(["children", "key", "ref", "dangerouslySetInnerHTML"]);

// Props that map to DOM properties rather than attributes
const DOM_PROPERTIES = new Set(["value", "checked", "selected", "disabled", "readOnly", "multiple", "indeterminate"]);

// Prop name aliases
const PROP_ALIASES: Record<string, string> = {
  className: "class",
  htmlFor: "for",
  tabIndex: "tabindex",
  crossOrigin: "crossorigin",
};

/**
 * Apply all non-event props to a DOM element.
 * Handles static values, reactive signals, and special cases.
 * Returns an array of disposers for reactive attributes.
 */
export function applyAttributes(
  el: Element,
  props: Record<string, unknown>,
): CleanupFn[] {
  const disposers: CleanupFn[] = [];

  for (const [key, value] of Object.entries(props)) {
    if (SKIP_PROPS.has(key) || isEventProp(key)) continue;

    if (isSignal(value) || isComputed(value)) {
      // Reactive attribute — wrap in an effect
      const dispose = effect(() => {
        setSingleAttribute(el, key, (value as any).value);
      });
      disposers.push(dispose);
    } else {
      setSingleAttribute(el, key, value);
    }
  }

  return disposers;
}

/**
 * Set a single attribute/property on a DOM element.
 */
function setSingleAttribute(el: Element, key: string, value: unknown): void {
  // Resolve alias
  const attrName = PROP_ALIASES[key] ?? key;

  // Handle style objects
  if (attrName === "style" && typeof value === "object" && value !== null) {
    applyStyle(el as HTMLElement, value as Record<string, string>);
    return;
  }

  // Handle class arrays/objects
  if (attrName === "class" && typeof value === "object" && value !== null) {
    applyClass(el, value);
    return;
  }

  // Handle null/undefined/false — remove attribute
  if (value == null || value === false) {
    domOps.removeAttribute(el, attrName);
    // Also clear the property if it's a DOM property
    if (DOM_PROPERTIES.has(attrName)) {
      domOps.setProperty(el, attrName, attrName === "value" ? "" : false);
    }
    return;
  }

  // Handle boolean true — set as attribute name only
  if (value === true) {
    domOps.setAttribute(el, attrName, "");
    if (DOM_PROPERTIES.has(attrName)) {
      domOps.setProperty(el, attrName, true);
    }
    return;
  }

  // DOM properties — set directly on the element
  if (DOM_PROPERTIES.has(attrName)) {
    domOps.setProperty(el, attrName, value);
    return;
  }

  // Default — set as string attribute
  domOps.setAttribute(el, attrName, String(value));
}

/**
 * Apply a style object to an element.
 */
function applyStyle(el: HTMLElement, styles: Record<string, string>): void {
  for (const [prop, val] of Object.entries(styles)) {
    // Convert camelCase to kebab-case for style.setProperty
    if (prop.includes("-")) {
      el.style.setProperty(prop, val);
    } else {
      (el.style as any)[prop] = val;
    }
  }
}

/**
 * Apply class value — supports string, array, or object notation.
 */
function applyClass(el: Element, value: unknown): void {
  let classStr: string;

  if (Array.isArray(value)) {
    // ["foo", "bar", false && "baz"] → "foo bar"
    classStr = value.filter(Boolean).join(" ");
  } else if (typeof value === "object" && value !== null) {
    // { foo: true, bar: false } → "foo"
    classStr = Object.entries(value)
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k)
      .join(" ");
  } else {
    classStr = String(value);
  }

  domOps.setAttribute(el, "class", classStr);
}
