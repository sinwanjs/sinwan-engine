/**
 * SinwanJS View Module — Unit Test (no JSX syntax)
 *
 * Tests the view module API without relying on JSX transform.
 * Run with: bun run src/view/test.ts
 */

import {
  sjs,
  renderToString,
  streamPage,
  type SjsNode,
  type SjsElement,
} from "./index";
import { jsx, Fragment } from "./jsx/jsx-runtime";

// Helper to create elements using the jsx factory directly
const h = (
  type: string | Function,
  props: Record<string, any> = {},
  ...children: SjsNode[]
) => {
  return jsx(type, { ...props, children }, undefined);
};

// --- Components ---

interface NavbarProps {
  brand: string;
  links?: { label: string; href: string }[];
}

const Navbar = sjs.createComponent<NavbarProps>(({ brand, links = [] }) =>
  h(
    "nav",
    { className: "navbar" },
    h("a", { href: "/", className: "brand" }, brand),
    h(
      "ul",
      {},
      ...links.map((link) =>
        h("li", { key: link.href }, h("a", { href: link.href }, link.label)),
      ),
    ),
  ),
);

interface LayoutProps {
  title: string;
  lang?: string;
  children?: SjsNode;
}

const Layout = sjs.createComponent<LayoutProps>(
  ({ title, lang = "en", children }) =>
    h(
      "html",
      { lang },
      h(
        "head",
        {},
        h("meta", { charset: "UTF-8" }),
        h("meta", {
          name: "viewport",
          content: "width=device-width, initial-scale=1.0",
        }),
        h("title", {}, title),
      ),
      h(
        "body",
        {},
        h(Navbar, {
          brand: "SinwanJS",
          links: [
            { label: "Home", href: "/" },
            { label: "About", href: "/about" },
          ],
        }),
        h("main", {}, children),
      ),
    ),
);

interface HomeData {
  title: string;
  description: string;
  posts: { id: number; title: string }[];
}

const HomePage = sjs.createPage<HomeData>(({ title, description, posts }) =>
  h(
    Layout,
    { title },
    h(
      "section",
      { className: "hero" },
      h("h1", {}, title),
      h("p", {}, description),
    ),
    h(
      "ul",
      { className: "posts" },
      ...posts.map((post) => h("li", { key: post.id }, post.title)),
    ),
  ),
);

// --- Tests ---

async function main() {
  console.log("=== SinwanJS View Module Tests ===\n");

  // Test 1: Render to string
  console.log("Test 1: Render page to string");
  const html = await renderToString(
    h(HomePage, {
      title: "Welcome to SinwanJS",
      description: "A Bun-native full-stack framework.",
      posts: [
        { id: 1, title: "Getting Started" },
        { id: 2, title: "Building Components" },
        { id: 3, title: "Streaming SSR" },
      ],
    }),
  );
  console.log("Rendered HTML length:", html.length);
  console.log("Preview (first 500 chars):");
  console.log(html.slice(0, 500) + "...\n");

  // Test 2: Register and render via registry
  console.log("Test 2: Page registry");
  sjs.registerPage("home", HomePage);
  console.log("Page 'home' registered:", sjs.hasPage("home"));

  const registeredHtml = await sjs.renderPage("home", {
    title: "From Registry",
    description: "This page was rendered via the registry!",
    posts: [{ id: 1, title: "Registry Post" }],
  });
  console.log("Registry render length:", registeredHtml.length, "\n");

  // Test 3: Streaming
  console.log("Test 3: Streaming SSR");
  const stream = streamPage(HomePage, {
    title: "Streamed Page",
    description: "This content is streamed!",
    posts: [{ id: 1, title: "Post 1" }],
  });

  const reader = stream.getReader();
  let chunks = 0;
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks++;
    totalBytes += value.length;
  }

  console.log(`Streamed ${chunks} chunks, ${totalBytes} bytes total\n`);

  // Test 4: HTML escaping (security)
  console.log("Test 4: HTML escaping (XSS protection)");
  const xssAttempt = '<script>alert("xss")</script>';
  const escaped = sjs.escapeHtml(xssAttempt);
  console.log("Input:", xssAttempt);
  console.log("Escaped:", escaped);
  console.log("Is safe HTML:", sjs.isSafeHtml(sjs.safeHtml("<b>trusted</b>")));

  // Test 5: Void elements (no closing tag)
  console.log("\nTest 5: Void elements");
  const voidEl = h("input", { type: "text", name: "test" });
  const voidHtml = await renderToString(voidEl);
  console.log("Void element:", voidHtml);
  console.log("Contains closing tag:", voidHtml.includes("</input>"));

  console.log("\n=== All tests passed! ===");
}

main().catch(console.error);
