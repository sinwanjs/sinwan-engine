/**
 * SinwanJS Component Runtime — Instance Management
 *
 * Each component rendered on the client gets a ComponentInstance
 * that tracks its lifecycle hooks, effects, parent/child tree,
 * and provide/inject context.
 *
 * A global `currentInstance` stack lets lifecycle hooks (onMounted, etc.)
 * register themselves during setup — same pattern as Vue's getCurrentInstance.
 */

import type { SjsComponent } from "../../view/types.ts";
import type { MountedNode } from "../renderer/types.ts";
import type { CleanupFn } from "../reactivity/index.ts";

// ─── ComponentInstance ─────────────────────────────────────

let uidCounter = 0;

export interface ComponentInstance {
  /** Unique identifier for this instance. */
  uid: number;

  /** The component definition (setup function). */
  component: SjsComponent<any>;

  /** Props passed to this component. */
  props: Record<string, any>;

  /** The rendered DOM subtree (set after render). */
  element: MountedNode | null;

  /** Parent instance in the component tree. */
  parent: ComponentInstance | null;

  /** Child component instances. */
  children: ComponentInstance[];

  /** All effect dispose functions owned by this component. */
  effects: CleanupFn[];

  // ─── Lifecycle hook queues ────────────────────────────

  /** Callbacks to fire after the component is mounted to DOM. */
  _mountedHooks: (() => void)[];

  /** Callbacks to fire when the component is unmounted. */
  _unmountedHooks: (() => void)[];

  /** Callbacks to fire after any reactive update in this component. */
  _updatedHooks: (() => void)[];

  /** Error handler callbacks. */
  _errorHooks: ((err: Error) => void)[];

  // ─── Provide/Inject context ───────────────────────────

  /** Values provided by this instance (for inject in children). */
  provides: Record<string | symbol, unknown>;

  // ─── State flags ──────────────────────────────────────

  isMounted: boolean;
  isUnmounted: boolean;
}

/**
 * Create a fresh ComponentInstance.
 */
export function createComponentInstance(
  component: SjsComponent<any>,
  props: Record<string, any>,
  parent: ComponentInstance | null,
): ComponentInstance {
  return {
    uid: uidCounter++,
    component,
    props,
    element: null,
    parent,
    children: [],
    effects: [],
    _mountedHooks: [],
    _unmountedHooks: [],
    _updatedHooks: [],
    _errorHooks: [],
    // Inherit parent's provides (prototype chain for lookup)
    provides: parent ? Object.create(parent.provides) : Object.create(null),
    isMounted: false,
    isUnmounted: false,
  };
}

// ─── Current instance stack ────────────────────────────────

let currentInstance: ComponentInstance | null = null;

/**
 * Get the currently active component instance.
 * Used by lifecycle hooks to register themselves.
 */
export function getCurrentInstance(): ComponentInstance | null {
  return currentInstance;
}

/**
 * Set the current instance (called by renderer before setup).
 * Returns the previous instance for restoration.
 */
export function setCurrentInstance(instance: ComponentInstance | null): ComponentInstance | null {
  const prev = currentInstance;
  currentInstance = instance;
  return prev;
}

/**
 * Run a function with `instance` as the current component instance.
 * Automatically restores the previous instance when done.
 */
export function withInstance<T>(instance: ComponentInstance, fn: () => T): T {
  const prev = setCurrentInstance(instance);
  try {
    return fn();
  } finally {
    setCurrentInstance(prev);
  }
}

// ─── Lifecycle execution ───────────────────────────────────

/**
 * Fire all onMounted hooks for an instance and its children (depth-first).
 */
export function fireMountedHooks(instance: ComponentInstance): void {
  // Children first (bottom-up, like Vue)
  for (const child of instance.children) {
    fireMountedHooks(child);
  }

  if (!instance.isMounted) {
    instance.isMounted = true;
    for (const hook of instance._mountedHooks) {
      hook();
    }
  }
}

/**
 * Fire all onUnmounted hooks and dispose all effects for an instance
 * and its children (depth-first, children first).
 */
export function fireUnmountedHooks(instance: ComponentInstance): void {
  // Children first
  for (const child of instance.children) {
    fireUnmountedHooks(child);
  }

  if (instance.isMounted && !instance.isUnmounted) {
    instance.isUnmounted = true;
    instance.isMounted = false;

    // Fire unmounted hooks
    for (const hook of instance._unmountedHooks) {
      hook();
    }

    // Dispose all effects owned by this component
    for (const dispose of instance.effects) {
      dispose();
    }
    instance.effects.length = 0;
  }
}

/**
 * Fire onUpdated hooks for the current instance.
 */
export function fireUpdatedHooks(instance: ComponentInstance): void {
  for (const hook of instance._updatedHooks) {
    hook();
  }
}

/**
 * Handle an error in the component tree — walks up to find an error handler.
 */
export function handleComponentError(instance: ComponentInstance, err: Error): void {
  let current: ComponentInstance | null = instance;
  while (current) {
    if (current._errorHooks.length > 0) {
      for (const hook of current._errorHooks) {
        hook(err);
      }
      return;
    }
    current = current.parent;
  }
  // No handler found — re-throw
  console.error("[SJS] Unhandled component error:", err);
}
