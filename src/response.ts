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
 * Optimization: Only allocates Headers if they were actually used.
 */
export function buildResponse(ctx: Context): Response {
  const { body, statusCode } = ctx;

  // Check if headers were ever allocated (lazy init)
  const headers = ctx["_headers"];

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

  return Response.json(body, { status: statusCode, headers });
}
