/// <reference lib="dom" />

/**
 * SinwanJS Hydration — Marker Protocol
 *
 * Constants and helpers for the hydration marker format:
 *
 *   data-sjs-id="c0"             — component boundary
 *   <!--sjs-t:0-->val<!--/sjs-t-->  — reactive text boundary
 *   data-sjs-ev="click:0"        — event binding reference
 */

// ─── Constants ─────────────────────────────────────────────

/** Attribute on the root element of each component instance. */
export const COMP_ID_ATTR = "data-sjs-id";

/** Prefix for component IDs. */
export const COMP_ID_PREFIX = "c";

/** Opening comment prefix for reactive text slots: `sjs-t:N` */
export const TEXT_MARKER_OPEN = "sjs-t:";

/** Closing comment for reactive text slots. */
export const TEXT_MARKER_CLOSE = "/sjs-t";

/** Attribute for event binding references. */
export const EVENT_ATTR = "data-sjs-ev";

// ─── Server-side marker generation ────────────────────────

/** Build a component ID string, e.g. `"c0"`. */
export function compId(index: number): string {
  return `${COMP_ID_PREFIX}${index}`;
}

/** Build an opening text marker comment string. */
export function textMarkerOpen(index: number): string {
  return `<!--${TEXT_MARKER_OPEN}${index}-->`;
}

/** Build a closing text marker comment string. */
export function textMarkerCloseStr(): string {
  return `<!--${TEXT_MARKER_CLOSE}-->`;
}

/** Build an event attribute value, e.g. `"click:0"`. */
export function eventAttrValue(event: string, index: number): string {
  return `${event}:${index}`;
}

// ─── Client-side marker parsing ───────────────────────────

/**
 * Check if a comment node is a reactive text opening marker.
 * Returns the slot index, or -1 if not a marker.
 */
export function parseTextOpenMarker(node: Comment): number {
  const data = node.data;
  if (data.startsWith(TEXT_MARKER_OPEN)) {
    const idx = parseInt(data.slice(TEXT_MARKER_OPEN.length), 10);
    return Number.isNaN(idx) ? -1 : idx;
  }
  return -1;
}

/**
 * Check if a comment node is a reactive text closing marker.
 */
export function isTextCloseMarker(node: Comment): boolean {
  return node.data === TEXT_MARKER_CLOSE;
}

/**
 * Parse `data-sjs-ev` attribute value into event entries.
 * Format: `"click:0"` or `"click:0,input:1"` for multiple.
 * Returns array of `[eventName, handlerIndex]` tuples.
 */
export function parseEventAttr(value: string): [string, number][] {
  return value.split(",").map((pair) => {
    const [event, idx] = pair.split(":");
    return [event!, parseInt(idx!, 10)];
  });
}

/**
 * Parse `data-sjs-id` into the component index.
 * e.g., `"c3"` → `3`
 */
export function parseCompId(value: string): number {
  return parseInt(value.slice(COMP_ID_PREFIX.length), 10);
}
