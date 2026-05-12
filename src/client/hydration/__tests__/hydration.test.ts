/**
 * SinwanJS Hydration — Unit Tests
 *
 * Tests the full SSR → hydration flow:
 *   1. Server renders with markers (renderToHydratableString)
 *   2. Client hydrates the HTML (hydrate)
 *   3. Reactivity + events work on the existing DOM
 *
 * Run with: bun test src/client/hydration/__tests__/hydration.test.ts
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Window } from "happy-dom";
import { signal, computed, nextTick } from "../../reactivity/index.ts";
import { onMounted, onUnmounted, provide, inject } from "../../component/index.ts";
import { hydrate } from "../hydrate.ts";
import { renderToHydratableString } from "../../../server/hydration-markers.ts";
import { createComponent } from "../../../view/component.ts";
import type { SjsElement } from "../../../view/types.ts";
import {
  parseTextOpenMarker,
  isTextCloseMarker,
  parseEventAttr,
  parseCompId,
} from "../markers.ts";

// ─── DOM setup ─────────────────────────────────────────────

let win: InstanceType<typeof Window>;
let doc: Document;
let container: HTMLElement;

beforeEach(() => {
  win = new Window({ url: "http://localhost" });
  doc = win.document as unknown as Document;
  (globalThis as any).document = doc;
  (globalThis as any).window = win;

  container = doc.createElement("div");
  container.setAttribute("id", "app");
  doc.body.appendChild(container);
});

// ─── Helper ────────────────────────────────────────────────

function el(tag: string, props: Record<string, unknown> = {}, ...children: any[]): SjsElement {
  return { tag, props: { ...props, children }, children };
}

function byTag(parent: Node, tag: string): HTMLElement[] {
  return Array.from((parent as HTMLElement).getElementsByTagName(tag)) as unknown as HTMLElement[];
}

// ─── Marker parsing ────────────────────────────────────────

describe("marker helpers", () => {
  it("parseCompId parses component IDs", () => {
    expect(parseCompId("c0")).toBe(0);
    expect(parseCompId("c42")).toBe(42);
  });

  it("parseEventAttr parses event references", () => {
    expect(parseEventAttr("click:0")).toEqual([["click", 0]]);
    expect(parseEventAttr("click:0,input:1")).toEqual([["click", 0], ["input", 1]]);
  });
});

// ─── renderToHydratableString ──────────────────────────────

describe("renderToHydratableString", () => {
  it("injects component boundary marker", async () => {
    const App = createComponent(() => el("div", {}, "hello"));
    const html = await renderToHydratableString(App);

    expect(html).toContain('data-sjs-id="c0"');
    expect(html).toContain("hello");
  });

  it("wraps signal values with text markers", async () => {
    const App = createComponent(() => {
      const count = signal(5);
      return el("p", {}, "Count: ", count as any);
    });

    const html = await renderToHydratableString(App);
    expect(html).toContain("Count: ");
    expect(html).toContain("<!--sjs-t:0-->5<!--/sjs-t-->");
  });

  it("adds event markers", async () => {
    const App = createComponent(() => {
      return el("button", { onClick: () => {} }, "Click");
    });

    const html = await renderToHydratableString(App);
    expect(html).toContain('data-sjs-ev="click:0"');
  });

  it("handles nested components", async () => {
    const Child = createComponent(() => el("span", {}, "child"));

    const App = createComponent(() => {
      return el("div", {},
        { tag: Child, props: {}, children: [] } as any,
      );
    });

    const html = await renderToHydratableString(App);
    // Both parent and child get component IDs
    expect(html).toContain('data-sjs-id="c0"'); // App's div
    expect(html).toContain('data-sjs-id="c1"'); // Child's span
  });

  it("renders static + reactive children correctly", async () => {
    const App = createComponent(() => {
      const name = signal("World");
      return el("h1", {}, "Hello ", name as any, "!");
    });

    const html = await renderToHydratableString(App);
    expect(html).toContain("Hello ");
    expect(html).toContain("<!--sjs-t:0-->World<!--/sjs-t-->");
    expect(html).toContain("!");
  });
});

// ─── Full hydration flow ───────────────────────────────────

describe("hydrate", () => {
  it("hydrates static HTML without errors", async () => {
    const App = createComponent(() => el("div", {}, "Hello"));

    const html = await renderToHydratableString(App);
    container.innerHTML = html;

    const app = hydrate(App, container);
    expect(app.root).toBeDefined();
    expect(container.textContent).toContain("Hello");
  });

  it("reactive text updates after hydration", async () => {
    const App = createComponent(() => {
      const count = signal(5);
      return el("div", {},
        el("span", {}, "Count: ", count as any),
        el("button", { onClick: () => { count.value++; } }, "+"),
      );
    });

    // SSR
    const html = await renderToHydratableString(App);
    container.innerHTML = html;

    expect(container.textContent).toContain("Count: 5");

    // Hydrate
    hydrate(App, container);

    // The DOM should still show the same content
    expect(container.textContent).toContain("Count: 5");

    // Click the button to increment
    const btn = byTag(container, "button")[0]!;
    btn.click();
    await nextTick();

    expect(container.textContent).toContain("Count: 6");
  });

  it("computed values update after hydration", async () => {
    const App = createComponent(() => {
      const price = signal(10);
      const qty = signal(3);
      const total = computed(() => price.value * qty.value);

      return el("div", {},
        el("span", {}, "Total: ", total as any),
        el("button", { onClick: () => { qty.value++; } }, "Add"),
      );
    });

    const html = await renderToHydratableString(App);
    container.innerHTML = html;

    hydrate(App, container);

    expect(container.textContent).toContain("Total: 30");

    const btn = byTag(container, "button")[0]!;
    btn.click();
    await nextTick();

    expect(container.textContent).toContain("Total: 40");
  });

  it("onMounted fires during hydration", async () => {
    let mounted = false;

    const App = createComponent(() => {
      onMounted(() => { mounted = true; });
      return el("div", {}, "hello");
    });

    const html = await renderToHydratableString(App);
    container.innerHTML = html;

    expect(mounted).toBe(false);
    hydrate(App, container);
    expect(mounted).toBe(true);
  });

  it("onUnmounted fires on app.unmount()", async () => {
    let unmounted = false;

    const App = createComponent(() => {
      onUnmounted(() => { unmounted = true; });
      return el("div", {}, "hello");
    });

    const html = await renderToHydratableString(App);
    container.innerHTML = html;

    const app = hydrate(App, container);
    expect(unmounted).toBe(false);

    app.unmount();
    expect(unmounted).toBe(true);
  });

  it("reuses existing DOM nodes (no recreation)", async () => {
    const App = createComponent(() => {
      return el("div", { class: "root" },
        el("h1", {}, "Title"),
        el("p", {}, "Body"),
      );
    });

    const html = await renderToHydratableString(App);
    container.innerHTML = html;

    // Capture references to existing DOM nodes
    const originalDiv = container.firstElementChild!;
    const originalH1 = byTag(container, "h1")[0]!;

    hydrate(App, container);

    // Same DOM nodes should be reused
    expect(container.firstElementChild).toBe(originalDiv);
    expect(byTag(container, "h1")[0]).toBe(originalH1);
  });

  it("event handlers are attached during hydration", async () => {
    let clicked = false;

    const App = createComponent(() => {
      return el("button", { onClick: () => { clicked = true; } }, "Click me");
    });

    const html = await renderToHydratableString(App);
    container.innerHTML = html;

    hydrate(App, container);

    const btn = byTag(container, "button")[0]!;
    btn.click();
    expect(clicked).toBe(true);
  });

  it("interactive counter: full SSR → hydrate → click flow", async () => {
    const Counter = createComponent<{ initial?: number }>(({ initial = 0 }) => {
      const count = signal(initial as number);
      return el("div", {},
        el("span", {}, count as any),
        el("button", { onClick: () => { count.value++; } }, "+"),
        el("button", { onClick: () => { count.value--; } }, "-"),
      );
    });

    // SSR
    const html = await renderToHydratableString(Counter, { initial: 10 });
    container.innerHTML = html;
    expect(container.textContent).toContain("10");

    // Hydrate
    hydrate(Counter, container, { initial: 10 });

    const span = byTag(container, "span")[0]!;
    const buttons = byTag(container, "button");
    const incBtn = buttons[0]!;
    const decBtn = buttons[1]!;

    expect(span.textContent).toBe("10");

    incBtn.click();
    await nextTick();
    expect(span.textContent).toBe("11");

    incBtn.click();
    await nextTick();
    expect(span.textContent).toBe("12");

    decBtn.click();
    await nextTick();
    expect(span.textContent).toBe("11");
  });
});
