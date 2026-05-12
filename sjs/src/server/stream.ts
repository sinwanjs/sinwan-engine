/**
 * SinwanJS View Module — Streaming SSR
 *
 * Progressive HTML streaming using Bun's native ReadableStream.
 * Streams chunks as they resolve without waiting for full tree.
 */

import type { SjsNode, SjsElement, SjsPage } from "../types.ts";
import { HtmlEscapedString, escapeHtml } from "../escaper.ts";

// Void elements that don't have closing tags
const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Stream a page to a ReadableStream.
 */
export function streamPage<D extends object = {}>(
  page: SjsPage<D>,
  data: D,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        // Resolve the page component
        const element = await page(data);

        // Stream the element tree
        await streamNode(element, controller, encoder);

        // Close the stream
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/**
 * Stream a node tree to a controller.
 */
async function streamNode(
  node: SjsNode,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): Promise<void> {
  // Handle null/undefined/boolean
  if (node == null || typeof node === "boolean") {
    return;
  }

  // Handle strings (escape them)
  if (typeof node === "string") {
    controller.enqueue(encoder.encode(escapeHtml(node)));
    return;
  }

  // Handle numbers
  if (typeof node === "number") {
    controller.enqueue(encoder.encode(String(node)));
    return;
  }

  // Handle pre-escaped HTML
  if (node instanceof HtmlEscapedString) {
    controller.enqueue(encoder.encode(node.value));
    return;
  }

  // Handle arrays - stream each child
  if (Array.isArray(node)) {
    for (const child of node) {
      await streamNode(child, controller, encoder);
    }
    return;
  }

  // Handle async elements (Promise<SjsElement>)
  if (node instanceof Promise) {
    const resolved = await node;
    await streamElement(resolved, controller, encoder);
    return;
  }

  // Handle elements
  await streamElement(node, controller, encoder);
}

/**
 * Stream an element to the controller.
 */
async function streamElement(
  element: SjsElement,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): Promise<void> {
  const { tag, props, children } = element;

  // Handle functional components
  if (typeof tag === "function") {
    const result = await tag(props);
    await streamNode(result, controller, encoder);
    return;
  }

  // Handle intrinsic HTML elements
  if (typeof tag === "string") {
    await streamIntrinsicElement(tag, props, children, controller, encoder);
    return;
  }

  // Fallback
  await streamNode(children, controller, encoder);
}

/**
 * Stream an intrinsic HTML element.
 */
async function streamIntrinsicElement(
  tag: string,
  props: Record<string, unknown>,
  children: SjsNode[],
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): Promise<void> {
  const attrs = renderAttributes(props);

  // Check for dangerous inner HTML
  const dangerous = props.dangerouslySetInnerHTML as
    | { __html?: string }
    | undefined;

  // Void elements have no children and no closing tag
  if (VOID_ELEMENTS.has(tag)) {
    const html = attrs ? `<${tag}${attrs}>` : `<${tag}>`;
    controller.enqueue(encoder.encode(html));
    return;
  }

  // Opening tag
  const openTag = attrs ? `<${tag}${attrs}>` : `<${tag}>`;
  controller.enqueue(encoder.encode(openTag));

  // Children or dangerous HTML
  if (dangerous && typeof dangerous.__html === "string") {
    controller.enqueue(encoder.encode(dangerous.__html));
  } else {
    await streamNode(children, controller, encoder);
  }

  // Closing tag
  controller.enqueue(encoder.encode(`</${tag}>`));
}

/**
 * Render HTML attributes from props.
 */
function renderAttributes(props: Record<string, unknown>): string {
  let attrs = "";

  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || key === "dangerouslySetInnerHTML") continue;
    if (value == null || value === false) continue;

    if (value === true) {
      attrs += ` ${key}`;
      continue;
    }

    const attrName =
      key === "className" ? "class" : key === "htmlFor" ? "for" : key;
    const attrValue = escapeHtml(String(value));
    attrs += ` ${attrName}="${attrValue}"`;
  }

  return attrs;
}
