/**
 * SinwanJS Client — Public API
 *
 * Client-side runtime: reactivity, renderer, component lifecycle,
 * hydration, and optional router.
 *
 * Phase 1: Reactivity Core
 * Phase 2: Client DOM Renderer
 * Phase 3: Component Lifecycle
 * Phase 4: Hydration
 */

// ─── Reactivity ────────────────────────────────────────────

export {
  signal,
  isSignal,
  computed,
  isComputed,
  effect,
  batch,
  nextTick,
} from "./reactivity/index.ts";

export type {
  Signal,
  Computed,
  CleanupFn,
  EffectFn,
} from "./reactivity/index.ts";

// ─── Renderer ──────────────────────────────────────────────

export {
  mount,
  render,
  unmountNode,
  renderNodeToDOM,
  renderElementToDOM,
} from "./renderer/index.ts";

export type { MountedNode, AppInstance } from "./renderer/index.ts";

// ─── Component Lifecycle ───────────────────────────────────

export {
  onMounted,
  onUnmounted,
  onUpdated,
  onError,
} from "./component/index.ts";

export { provide, inject, getCurrentInstance } from "./component/index.ts";

export type { ComponentInstance, InjectionKey } from "./component/index.ts";

// ─── Hydration ─────────────────────────────────────────────

export { hydrate } from "./hydration/index.ts";
