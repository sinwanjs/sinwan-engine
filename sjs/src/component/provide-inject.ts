/**
 * SinwanJS Component Runtime — Provide / Inject
 *
 * Dependency injection system like Vue's provide/inject.
 * A parent component provides a value; any descendant can inject it.
 * Uses prototype chain inheritance on the instance's `provides` object.
 */

import { getCurrentInstance } from "./instance.ts";

/** Injection key — string or symbol for type safety. */
export type InjectionKey<T> = symbol & { __type?: T };

/**
 * Provide a value for descendants to inject.
 * Must be called during component setup.
 *
 * @example
 * const ThemeKey: InjectionKey<string> = Symbol("theme");
 *
 * const App = createComponent(() => {
 *   provide(ThemeKey, "dark");
 *   return <Child />;
 * });
 */
export function provide<T>(key: string | symbol, value: T): void {
  const instance = getCurrentInstance();
  if (!instance) {
    throw new Error("provide() called outside of component setup.");
  }

  // If this instance inherited provides from parent via Object.create,
  // and we're providing a new key, we need to make sure we write to
  // this instance's own object (not the prototype).
  // Object.create already handles this — own properties shadow prototype.
  instance.provides[key as any] = value;
}

/**
 * Inject a value provided by an ancestor component.
 * Must be called during component setup.
 *
 * @param key - The injection key
 * @param defaultValue - Fallback if no ancestor provides this key
 *
 * @example
 * const Child = createComponent(() => {
 *   const theme = inject(ThemeKey, "light");
 *   return <div class={theme}>Hello</div>;
 * });
 */
export function inject<T>(key: string | symbol, defaultValue?: T): T {
  const instance = getCurrentInstance();
  if (!instance) {
    throw new Error("inject() called outside of component setup.");
  }

  // Walk the provides chain (prototype-based lookup)
  if ((key as any) in instance.provides) {
    return instance.provides[key as any] as T;
  }

  if (arguments.length >= 2) {
    return defaultValue as T;
  }

  console.warn(`[SJS] inject() key "${String(key)}" not found and no default provided.`);
  return undefined as T;
}
