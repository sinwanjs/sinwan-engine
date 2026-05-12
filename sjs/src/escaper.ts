/**
 * SinwanJS View Module — HTML Escaping
 *
 * Security utilities for sanitizing interpolated values.
 * Uses Bun.escapeHTML for optimal performance.
 */

import { HtmlEscapedString, raw } from "./jsx/jsx-runtime";

export { HtmlEscapedString, raw };

/**
 * Escape HTML entities in a string value.
 * Delegates to Bun.escapeHTML for native performance.
 */
export function escapeHtml(value: unknown): string {
  if (value == null || typeof value === "boolean") return "";
  if (typeof value === "number") return String(value);
  if (value instanceof HtmlEscapedString) return value.value;
  return Bun.escapeHTML(String(value));
}

/**
 * Mark a string as safe HTML (pre-escaped).
 * USE WITH CAUTION - only for trusted content!
 */
export function safeHtml(html: string): HtmlEscapedString {
  return raw(html);
}

/**
 * Check if a value is already escaped HTML.
 */
export function isSafeHtml(value: unknown): value is HtmlEscapedString {
  return value instanceof HtmlEscapedString;
}
