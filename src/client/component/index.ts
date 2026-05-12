/**
 * SinwanJS Component Runtime — Public API
 */

// Instance management
export {
  getCurrentInstance,
  setCurrentInstance,
  withInstance,
  createComponentInstance,
  fireMountedHooks,
  fireUnmountedHooks,
  fireUpdatedHooks,
  handleComponentError,
} from "./instance.ts";

export type { ComponentInstance } from "./instance.ts";

// Lifecycle hooks
export { onMounted, onUnmounted, onUpdated, onError } from "./lifecycle.ts";

// Dependency injection
export { provide, inject } from "./provide-inject.ts";
export type { InjectionKey } from "./provide-inject.ts";
