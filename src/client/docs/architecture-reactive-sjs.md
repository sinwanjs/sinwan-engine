# SinwanJS Reactive Client Architecture

> Design document for building a Vue-like reactive client system on top of the SJS engine.

---

## Table of Contents

1. [Current State](#1-current-state)
2. [Target Vision](#2-target-vision)
3. [Architecture Overview](#3-architecture-overview)
4. [Module 1: Reactivity Core (`src/client/reactivity/`)](#4-module-1-reactivity-core)
5. [Module 2: Client-Side Renderer (`src/client/renderer/`)](#5-module-2-client-side-renderer)
6. [Module 3: Component Runtime (`src/client/component/`)](#6-module-3-component-runtime)
7. [Module 4: Hydration (`src/client/hydration/`)](#7-module-4-hydration)
8. [Module 5: Router (optional) (`src/client/router/`)](#8-module-5-router-optional)
9. [File Structure](#9-file-structure)
10. [Implementation Phases](#10-implementation-phases)
11. [API Surface — User-Facing](#11-api-surface)
12. [Design Decisions](#12-design-decisions)

---

## 1. Current State

SJS today is a **server-side JSX framework**:

```
JSX (.tsx)
  ↓ TypeScript compiler (react-jsx mode)
  ↓ Auto-imports jsx/jsxs/Fragment from sinwan-jsx/jsx-runtime
  ↓
jsx() factory → SjsElement { tag, props, children }
  ↓
renderToString() → HTML string    (full SSR)
streamPage()    → ReadableStream  (streaming SSR)
  ↓
HTTP Response via Context (c.render / c.streamRender)
```

**What exists:**
- `src/view/jsx/jsx-runtime.ts` — JSX factory producing `SjsElement` trees
- `src/view/renderer.ts` — async tree-walker → HTML string
- `src/view/stream.ts` — async tree-walker → chunked stream
- `src/view/component.ts` — `createComponent`, `createPage`, `createLayout`
- `src/view/types.ts` — `SjsElement`, `SjsNode`, `SjsComponent`, `SjsPage`

**What does NOT exist (client-side):**
- No reactivity (signals, computed, effects)
- No DOM renderer (only string renderer)
- No hydration (no SSR → client handoff)
- No client-side component lifecycle
- No client-side router

---

## 2. Target Vision

A developer using SJS should be able to write:

```tsx
import { signal, computed, createComponent, onMounted, onUnmounted } from "sinwan";

const Counter = createComponent<{ initial?: number }>(({ initial = 0 }) => {
  const count = signal(initial);
  const doubled = computed(() => count.value * 2);

  onMounted(() => {
    console.log("Counter mounted!");
  });

  return (
    <div class="counter">
      <p>Count: {count} — Doubled: {doubled}</p>
      <button onclick={() => count.value++}>+1</button>
      <button onclick={() => count.value--}>-1</button>
    </div>
  );
});
```

And the framework handles:
1. **Server:** Renders initial HTML with `count = 0`
2. **Client:** Hydrates, attaches reactivity, buttons work without full re-render
3. **Updates:** Only the `<p>` text node patches when `count` changes

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        SinwanJS Framework                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────────────┐     │
│  │ JSX Runtime │    │  Reactivity Core  │    │  Component Runtime  │     │
│  │ (shared)    │    │  signal/computed  │    │  lifecycle/setup    │     │
│  │             │    │  effect/batch     │    │  props/slots        │     │
│  └──────┬──────┘    └────────┬─────────┘    └─────────┬──────────┘     │
│         │                    │                         │                 │
│         ▼                    ▼                         ▼                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      Rendering Layer                             │   │
│  ├──────────────────────┬──────────────────────────────────────────┤   │
│  │   Server Renderer    │          Client Renderer                  │   │
│  │   (renderToString)   │   (mount / patch / unmount)               │   │
│  │   (streamPage)       │   (VDOM diff or fine-grained)             │   │
│  └──────────┬───────────┴──────────────────┬───────────────────────┘   │
│             │                              │                            │
│             ▼                              ▼                            │
│  ┌──────────────────┐          ┌───────────────────────┐               │
│  │   HTML String     │          │   Real DOM (browser)   │               │
│  │   (Response)      │          │   + Event delegation   │               │
│  └──────────────────┘          └───────────────────────┘               │
│                                         ▲                               │
│                                         │                               │
│                              ┌──────────┴──────────┐                   │
│                              │     Hydration        │                   │
│                              │  SSR HTML → Live DOM  │                   │
│                              └─────────────────────┘                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Module 1: Reactivity Core

> Inspired by: Vue 3 (`@vue/reactivity`), Solid.js signals, Preact signals

### Design: Fine-grained signals (not VDOM diff)

Unlike React (which re-renders entire subtrees), SJS will use **fine-grained reactivity** like Vue 3 / Solid:
- Signals track which effects/computeds depend on them
- When a signal changes, only the subscribed effects re-run
- DOM updates are surgical (patch a text node, toggle a class)

### Core primitives

```ts
// src/client/reactivity/signal.ts

interface Signal<T> {
  value: T;               // get/set triggers tracking/notification
  peek(): T;             // read without tracking
  subscribe(fn: () => void): () => void;  // manual subscription
}

function signal<T>(initial: T): Signal<T>;
```

```ts
// src/client/reactivity/computed.ts

interface Computed<T> {
  readonly value: T;     // lazily evaluated, cached
}

function computed<T>(fn: () => T): Computed<T>;
```

```ts
// src/client/reactivity/effect.ts

type CleanupFn = () => void;
type EffectFn = () => CleanupFn | void;

function effect(fn: EffectFn): CleanupFn;
```

```ts
// src/client/reactivity/batch.ts

// Batch multiple signal updates into a single flush
function batch(fn: () => void): void;
```

### Internal tracking mechanism

```ts
// Global tracking state
let activeEffect: EffectNode | null = null;
const effectStack: EffectNode[] = [];

// Each signal maintains a Set<EffectNode> of subscribers
// Each effect maintains a Set<Signal> of dependencies (for cleanup)

// Dependency graph:
//   Signal ←──subscribes── Effect
//   Signal ──notifies────→ Effect
```

### Scheduling

```ts
// src/client/reactivity/scheduler.ts

// Effects are NOT run synchronously on signal write.
// They are queued and flushed in a microtask (like Vue's nextTick).
const pendingEffects = new Set<EffectNode>();
let flushScheduled = false;

function scheduleFlush() {
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flush);
  }
}

function flush() {
  flushScheduled = false;
  for (const effect of pendingEffects) {
    effect.run();
  }
  pendingEffects.clear();
}
```

---

## 5. Module 2: Client-Side Renderer

> Two strategies to choose from. Recommendation: **Fine-grained DOM** (like Solid/Vue 3 Vapor)

### Strategy A: Virtual DOM Diff (React/Vue 3 default)

```
signal changes → re-run render function → new SjsElement tree
  → diff(oldTree, newTree) → DOM patches
```

- Pros: Simple mental model, works with any component pattern
- Cons: Re-runs entire component render function, allocates intermediate trees

### Strategy B: Fine-grained DOM (Recommended for SJS)

```
signal changes → effect runs → directly patches the DOM node it owns
```

- Pros: No VDOM overhead, surgical updates, tiny bundle
- Cons: Compiler/runtime must track which DOM nodes depend on which signals

### Recommended: Hybrid approach

- **Static JSX** (no signals in expressions) → renders once, no tracking
- **Dynamic expressions** (signal.value in JSX) → wrapped in micro-effects that patch their DOM node

```tsx
// This JSX:
<p>Count: {count} — Doubled: {doubled}</p>

// Compiles to (conceptually):
const p = document.createElement("p");
const text1 = document.createTextNode("Count: ");
const text2 = document.createTextNode("");  // reactive
const text3 = document.createTextNode(" — Doubled: ");
const text4 = document.createTextNode("");  // reactive

effect(() => { text2.data = String(count.value); });
effect(() => { text4.data = String(doubled.value); });

p.append(text1, text2, text3, text4);
```

### DOM rendering API

```ts
// src/client/renderer/mount.ts

// Mount a component into a DOM container
function mount(component: SjsComponent, container: Element, props?: object): AppInstance;

// src/client/renderer/dom-ops.ts

// Low-level DOM operations (abstracted for testability)
interface DOMOps {
  createElement(tag: string): Element;
  createTextNode(text: string): Text;
  setAttribute(el: Element, key: string, value: any): void;
  removeAttribute(el: Element, key: string): void;
  insertBefore(parent: Node, child: Node, anchor: Node | null): void;
  remove(node: Node): void;
  setTextContent(node: Text, text: string): void;
  addEventListener(el: Element, event: string, handler: Function): void;
  removeEventListener(el: Element, event: string, handler: Function): void;
}
```

### Rendering SjsElement to DOM

```ts
// src/client/renderer/render.ts

function renderToDOM(node: SjsNode, parent: Element): MountedNode {
  if (typeof node === "string" || typeof node === "number") {
    const text = document.createTextNode(String(node));
    parent.appendChild(text);
    return { type: "text", node: text };
  }

  if (isSignal(node) || isComputed(node)) {
    // Reactive text — create effect
    const text = document.createTextNode("");
    effect(() => { text.data = String(node.value); });
    parent.appendChild(text);
    return { type: "reactive-text", node: text };
  }

  if (isElement(node)) {
    return renderElementToDOM(node, parent);
  }

  // arrays, fragments, etc.
}
```

---

## 6. Module 3: Component Runtime

### Component instance lifecycle

```
createComponent(setup)
     │
     ▼
┌─ setup() runs ─────────────────────────────────────────────┐
│  - Signals created (component-scoped)                       │
│  - Computed values created                                  │
│  - Lifecycle hooks registered (onMounted, onUnmounted...)   │
│  - Returns SjsElement (the template)                        │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
  mount(element, container)
     │
     ▼
  onMounted callbacks fire
     │
     ▼
  [reactive updates happen via effects]
     │
     ▼
  unmount()
     │
     ▼
  onUnmounted callbacks fire
  All effects disposed
  All subscriptions cleaned up
```

### Lifecycle hooks

```ts
// src/client/component/lifecycle.ts

function onMounted(fn: () => void): void;
function onUnmounted(fn: () => void): void;
function onUpdated(fn: () => void): void;    // after any reactive update in this component
function onError(fn: (err: Error) => void): void;
```

Lifecycle hooks use a **component context stack** (like Vue's `getCurrentInstance`):

```ts
let currentInstance: ComponentInstance | null = null;

function setCurrentInstance(instance: ComponentInstance) {
  currentInstance = instance;
}

function onMounted(fn: () => void) {
  if (!currentInstance) throw new Error("onMounted called outside setup");
  currentInstance._mountedHooks.push(fn);
}
```

### Component instance

```ts
interface ComponentInstance {
  uid: number;
  component: SjsComponent<any>;
  props: Record<string, any>;
  element: MountedNode | null;     // the rendered DOM subtree
  parent: ComponentInstance | null;
  children: ComponentInstance[];
  effects: EffectCleanup[];        // all effects owned by this component
  _mountedHooks: Function[];
  _unmountedHooks: Function[];
  _updatedHooks: Function[];
  isMounted: boolean;
  isUnmounted: boolean;
}
```

### Dual-mode components (server + client)

A single `createComponent` call should work on **both** server and client:

```tsx
const Card = createComponent<{ title: string }>(({ title, children }) => {
  // On server: signals are inert (just hold initial value)
  // On client: signals are reactive
  const expanded = signal(false);

  return (
    <div class="card">
      <h2 onclick={() => expanded.value = !expanded.value}>{title}</h2>
      {expanded.value && <div class="body">{children}</div>}
    </div>
  );
});
```

**Server behavior:**
- `signal(false)` returns `{ value: false }` (plain object, no tracking)
- Component renders once with `expanded = false`
- Output: static HTML

**Client behavior:**
- `signal(false)` returns a reactive signal
- `expanded.value` in JSX creates a tracked effect
- Clicking the `<h2>` toggles the signal → DOM updates

This is achieved via **conditional imports** or a build-time flag:

```ts
// src/client/reactivity/signal.ts — full reactive implementation
// src/view/reactivity/signal-server.ts — inert stub for SSR
```

---

## 7. Module 4: Hydration

### What hydration does

1. Server renders HTML (with hydration markers)
2. Client receives HTML (fast first paint)
3. Client "hydrates" — walks existing DOM, attaches events + reactivity
4. No DOM is created/destroyed during hydration (reuses server HTML)

### Hydration markers

During SSR, the renderer injects invisible markers:

```html
<!-- Server output -->
<div data-sjs-id="c0" class="card">
  <h2>Hello</h2>
  <p>Count: <!--sjs-t:0-->5<!--/sjs-t--></p>
  <button data-sjs-ev="click:0">+1</button>
</div>
```

Markers:
- `data-sjs-id="c0"` — component boundary (for matching instances)
- `<!--sjs-t:0-->...<!--/sjs-t-->` — reactive text boundary
- `data-sjs-ev="click:0"` — event binding reference

### Hydration algorithm

```ts
// src/client/hydration/hydrate.ts

function hydrate(component: SjsComponent, container: Element, props?: object): AppInstance {
  // 1. Run setup() to create signals, effects, lifecycle hooks
  // 2. Walk existing DOM (don't create new nodes)
  // 3. Match reactive slots (<!--sjs-t:N-->) to signal effects
  // 4. Attach event listeners to marked elements
  // 5. Fire onMounted hooks
}
```

### Partial hydration (islands architecture)

Not every component needs client-side interactivity. SJS can support **islands**:

```tsx
// Only this component hydrates on the client
const InteractiveCounter = createComponent.client<{ initial: number }>(({ initial }) => {
  const count = signal(initial);
  return <button onclick={() => count.value++}>Count: {count}</button>;
});

// This is server-only (never ships JS)
const StaticHeader = createComponent<{ title: string }>(({ title }) => (
  <header><h1>{title}</h1></header>
));
```

The `.client` marker tells the bundler to:
1. Include this component in the client bundle
2. Add hydration markers during SSR
3. Hydrate only these islands on page load

---

## 8. Module 5: Router (optional)

Client-side SPA navigation:

```ts
// src/client/router/router.ts

const router = createRouter({
  routes: [
    { path: "/", component: HomePage },
    { path: "/blog/:slug", component: BlogPost },
    { path: "/about", component: AboutPage },
  ],
});

// Provides:
// - <Link href="/blog/hello">...</Link> component
// - router.push("/about")
// - router.params (reactive signal)
// - router.path (reactive signal)
```

This is lower priority — the core reactive system comes first.

---

## 9. File Structure

```
src/
├── view/                          # Shared (server + client)
│   ├── jsx/
│   │   ├── jsx-runtime.ts         # JSX factory (SjsElement creation)
│   │   ├── jsx-dev-runtime.ts     # Dev mode JSX
│   │   └── jsx-types.ts           # IntrinsicElements type map
│   ├── types.ts                   # SjsElement, SjsNode, SjsComponent...
│   ├── component.ts              # createComponent, createPage, createLayout
│   ├── renderer.ts               # Server: renderToString
│   ├── stream.ts                 # Server: streamPage
│   ├── escaper.ts                # HTML escaping
│   ├── context-ext.ts            # c.render() / c.streamRender()
│   └── index.ts                  # Public barrel
│
├── client/                        # Client-only (ships to browser)
│   ├── reactivity/
│   │   ├── signal.ts             # signal(), Signal<T>
│   │   ├── computed.ts           # computed(), Computed<T>
│   │   ├── effect.ts            # effect(), tracking, cleanup
│   │   ├── batch.ts             # batch(), flush scheduling
│   │   ├── scheduler.ts         # Microtask queue, nextTick
│   │   └── index.ts             # Barrel
│   │
│   ├── renderer/
│   │   ├── mount.ts             # mount(component, container)
│   │   ├── patch.ts             # Fine-grained DOM patching
│   │   ├── dom-ops.ts           # DOM operation abstraction
│   │   ├── render-element.ts    # SjsElement → DOM nodes
│   │   ├── render-children.ts   # Child reconciliation
│   │   ├── attributes.ts        # Prop → attribute mapping
│   │   ├── events.ts            # Event delegation system
│   │   └── index.ts
│   │
│   ├── component/
│   │   ├── instance.ts          # ComponentInstance management
│   │   ├── lifecycle.ts         # onMounted, onUnmounted, etc.
│   │   ├── provide-inject.ts    # Dependency injection (like Vue provide/inject)
│   │   └── index.ts
│   │
│   ├── hydration/
│   │   ├── hydrate.ts           # hydrate(component, container)
│   │   ├── markers.ts           # Hydration marker protocol
│   │   ├── walk.ts              # DOM tree walker for matching
│   │   └── index.ts
│   │
│   ├── router/                   # Optional client SPA router
│   │   ├── router.ts
│   │   ├── link.ts              # <Link> component
│   │   └── index.ts
│   │
│   └── index.ts                  # Client public API
│
├── server/                        # Server-specific enhancements
│   ├── reactivity-stub.ts        # Inert signal/computed for SSR
│   └── hydration-markers.ts      # Inject markers during SSR
│
└── index.ts                       # Main entry (detects env)
```

---

## 10. Implementation Phases

### Phase 1: Reactivity Core (1–2 weeks)

**Goal:** `signal()`, `computed()`, `effect()`, `batch()` working in isolation.

Files:
- `src/client/reactivity/signal.ts`
- `src/client/reactivity/computed.ts`
- `src/client/reactivity/effect.ts`
- `src/client/reactivity/batch.ts`
- `src/client/reactivity/scheduler.ts`

**Test:** Unit tests — signals notify effects, computed caches, batch coalesces.

### Phase 2: Client DOM Renderer (1–2 weeks)

**Goal:** `mount(component, container)` renders a component tree to real DOM, reactive expressions auto-update.

Files:
- `src/client/renderer/mount.ts`
- `src/client/renderer/render-element.ts`
- `src/client/renderer/patch.ts`
- `src/client/renderer/events.ts`

**Test:** A counter component in a browser, clicking updates the DOM.

### Phase 3: Component Lifecycle (1 week)

**Goal:** `onMounted`, `onUnmounted`, component instance management, effect cleanup.

Files:
- `src/client/component/instance.ts`
- `src/client/component/lifecycle.ts`

**Test:** Components mount/unmount, effects are cleaned up, no memory leaks.

### Phase 4: Hydration (1–2 weeks)

**Goal:** Server renders HTML with markers. Client hydrates without re-creating DOM.

Files:
- `src/server/hydration-markers.ts` (modify renderer)
- `src/client/hydration/hydrate.ts`
- `src/client/hydration/walk.ts`

**Test:** SSR page loads, hydrates, interactive buttons work.

### Phase 5: Islands + Bundling (1 week)

**Goal:** Only interactive components ship JS to client. Static components are zero-JS.

**Test:** Page with 10 components, only 2 are interactive → bundle contains only those 2.

### Phase 6: Client Router (optional, 1 week)

**Goal:** SPA navigation without full page reloads.

---

## 11. API Surface

### Full user-facing API (what developers import)

```ts
// Reactivity
import { signal, computed, effect, batch, nextTick } from "sinwan/client";

// Components (works on both server + client)
import { createComponent, createPage, createLayout } from "sinwan";

// Client-only
import { mount, hydrate } from "sinwan/client";

// Lifecycle (only meaningful on client)
import { onMounted, onUnmounted, onUpdated } from "sinwan/client";

// Dependency injection
import { provide, inject } from "sinwan/client";

// Router (optional)
import { createRouter, Link, useRoute } from "sinwan/client/router";
```

### Comparison to Vue

| Vue 3 | SinwanJS equivalent |
|-------|---------------------|
| `ref(0)` | `signal(0)` |
| `reactive({})` | `signal({})` (deep proxy) or nested signals |
| `computed(() => ...)` | `computed(() => ...)` |
| `watch(source, cb)` | `effect(() => { /* use source.value */ })` |
| `watchEffect(fn)` | `effect(fn)` |
| `nextTick()` | `nextTick()` |
| `onMounted(fn)` | `onMounted(fn)` |
| `onUnmounted(fn)` | `onUnmounted(fn)` |
| `provide(key, val)` | `provide(key, val)` |
| `inject(key)` | `inject(key)` |
| `createApp(comp).mount(el)` | `mount(comp, el)` |
| Template `v-if` | JSX `{cond && <El/>}` |
| Template `v-for` | JSX `{list.map(x => <El/>)}` |
| Template `v-model` | JSX `value={sig.value} oninput={...}` |
| `<Suspense>` | Async components + `signal` loading states |

---

## 12. Design Decisions

### Why signals over VDOM?

| | VDOM (React) | Signals (Vue 3 / Solid) |
|--|------|---------|
| Bundle size | Larger (needs diff engine) | Smaller (~2KB reactivity) |
| Update granularity | Re-renders subtrees | Updates exact DOM nodes |
| Performance at scale | O(tree size) | O(changed signals) |
| Mental model | "Re-render everything" | "Subscribe to changes" |
| SSR compatibility | Easy | Easy |

**Decision:** Signals. Better perf, smaller bundle, aligns with modern trends.

### Why not use Vue/Solid directly?

- SJS already has its own JSX runtime and component model
- Tighter integration with Bun server (same types server ↔ client)
- No external dependency — full control over bundle
- Can optimize specifically for the SSR-first architecture

### Event delegation vs direct binding

**Decision:** Direct binding (like Solid) for simplicity.
- Each event handler is attached to its element
- No global event listener overhead
- Simpler hydration (just attach to the marked element)
- Consider delegation later if benchmarks show need

### Conditional rendering (v-if equivalent)

In JSX with signals:

```tsx
// Truthy check — effect re-runs when `show` changes
{show.value && <Modal />}

// Ternary
{loggedIn.value ? <Dashboard /> : <Login />}
```

Under the hood, these create **conditional effects** that mount/unmount child components.

### List rendering (v-for equivalent)

```tsx
const todos = signal([{ id: 1, text: "Hello" }]);

// Keyed list for efficient reconciliation
{todos.value.map(todo => <TodoItem key={todo.id} todo={todo} />)}
```

The renderer uses `key` for efficient list diffing (insert/remove/reorder without recreating all nodes).

---

## Next Steps

1. **Start with Phase 1** — build the reactivity core (signal, computed, effect)
2. Write unit tests to validate the tracking/notification mechanism
3. Then move to Phase 2 — render signals to actual DOM

The reactivity core is **independent** of the DOM — it can be tested in Node/Bun without a browser. This makes development fast and iterative.
