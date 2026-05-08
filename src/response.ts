/**
 * SinwanJS Core Runtime — Response Builder
 *
 * Converts a finalized Context into a Web API Response object.
 * Always produces a valid Response — never returns null/undefined.
 */

import type { Context } from "./context";

/**
 * Build a Web API Response from the finalized Context.
 *
 * Body handling:
 *  - string → sent as-is (text/plain or whatever Content-Type is set)
 *  - object/array → JSON.stringify'd, Content-Type set to application/json
 *  - null/undefined → empty body with current status code
 */
export function buildResponse(ctx: Context): Response {
  const { body, statusCode, headers } = ctx;

  // Most common fast path: pre-serialized string body (JSON or text)
  if (typeof body === "string") {
    return new Response(body, { status: statusCode, headers });
  }

  // No body — return empty response with status and headers
  if (body === null || body === undefined) {
    return new Response(null, { status: statusCode, headers });
  }

  // Stream, Buffer, File, Iterator, or object body — pass through to Bun
  // For non-string objects that weren't pre-serialized (e.g. direct body assignment),
  // fall back to JSON.stringify
  if (
    body instanceof ReadableStream ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof Blob ||
    typeof body === "function" ||
    (typeof body === "object" && Symbol.asyncIterator in body)
  ) {
    return new Response(body as any, { status: statusCode, headers });
  }

  // Fallback: Object/array body — serialize to JSON
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return new Response(JSON.stringify(body), { status: statusCode, headers });
}
