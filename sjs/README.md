# SJS — Reactive UI Library

A modern reactive UI library with SSR, hydration, and fine-grained reactivity.

## Features

- **Reactivity** — `signal()`, `computed()`, `effect()`, `batch()` with fine-grained tracking
- **JSX** — Custom JSX runtime producing `SjsElement` trees
- **Components** — `createComponent()` with lifecycle hooks (`onMounted`, `onUnmounted`, `onUpdated`, `onError`)
- **Renderer** — Client-side DOM renderer with reactive text, attributes, and event binding
- **Provide/Inject** — Dependency injection across component trees
- **SSR** — `renderToString()`, `streamPage()` for server-side rendering
- **Hydration** — `hydrate()` to attach reactivity to server-rendered HTML without DOM recreation

## Quick Start

```tsx
import { signal, createComponent, mount, onMounted } from "sjs";

const Counter = createComponent<{ initial?: number }>(({ initial = 0 }) => {
  const count = signal(initial);

  onMounted(() => console.log("Counter mounted!"));

  return (
    <div>
      <span>{count}</span>
      <button onClick={() => count.value++}>+</button>
    </div>
  );
});

mount(Counter, document.getElementById("app")!);
```

## SSR + Hydration

```tsx
// Server
import { renderToHydratableString } from "sjs/server";
const html = await renderToHydratableString(Counter, { initial: 5 });

// Client
import { hydrate } from "sjs";
hydrate(Counter, document.getElementById("app")!, { initial: 5 });
```

## Project Structure

```
src/
├── types.ts              # Core types (SjsNode, SjsElement, etc.)
├── escaper.ts            # HTML escaping
├── jsx/                  # JSX runtime
├── reactivity/           # signal, computed, effect, batch, scheduler
├── component/            # createComponent, lifecycle, provide/inject
├── renderer/             # Client DOM renderer (mount, render-element, etc.)
├── hydration/            # Client hydration (hydrate, markers, walk)
├── server/               # SSR (renderToString, stream, hydration-markers)
└── index.ts              # Main barrel export
```

## Tests

```bash
bun test
```
