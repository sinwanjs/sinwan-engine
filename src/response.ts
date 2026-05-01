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

  // No body — return empty response with status and headers
  if (body === null || body === undefined) {
    return new Response(null, { status: statusCode, headers });
  }

  // String body — return as-is
  if (typeof body === "string") {
    return new Response(body, { status: statusCode, headers });
  }

  // Stream or Buffer body — return as-is
  if (body instanceof ReadableStream || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return new Response(body as any, { status: statusCode, headers });
  }

  // Object/array body — serialize to JSON
  // Content-Type should already be set by ctx.json(), but ensure it as a fallback
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return new Response(JSON.stringify(body), { status: statusCode, headers });
}
