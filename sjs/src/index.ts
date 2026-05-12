// ─── Types ─────────────────────────────────────────────────

export type {
  SjsNode,
  SjsElement,
  SjsComponent,
  SjsPage,
  SjsLayout,
  SjsSlots,
  SjsPrimitive,
  RenderResult,
  PropsWithChildren,
  PropsWithSlots,
} from "./types.ts";

// ─── JSX Runtime ───────────────────────────────────────────

export {
  jsx,
  jsxs,
  jsxDEV,
  Fragment,
  raw,
  HtmlEscapedString,
} from "./jsx/jsx-runtime.ts";
export { escapeHtml, safeHtml, isSafeHtml } from "./escaper.ts";

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

// ─── Components ────────────────────────────────────────────

export {
  createComponent,
  createPage,
  createLayout,
} from "./component/index.ts";

export {
  onMounted,
  onUnmounted,
  onUpdated,
  onError,
} from "./component/index.ts";

export { provide, inject, getCurrentInstance } from "./component/index.ts";

export type { ComponentInstance, InjectionKey } from "./component/index.ts";

// ─── Renderer ──────────────────────────────────────────────

export {
  mount,
  render,
  unmountNode,
  renderNodeToDOM,
  renderElementToDOM,
} from "./renderer/index.ts";

export type { MountedNode, AppInstance } from "./renderer/index.ts";

// ─── Hydration ─────────────────────────────────────────────

export { hydrate } from "./hydration/index.ts";

// ─── Server (SSR) ──────────────────────────────────────────

export {
  renderToString,
  renderPage,
  registerPage,
  getPage,
  hasPage,
  streamPage,
  renderToHydratableString,
  renderNodeToHydratableString,
} from "./server/index.ts";
