/**
 * SinwanJS Reactivity — Computed
 *
 * A computed is a derived reactive value that lazily re-evaluates
 * when its dependencies change. It caches the result and only
 * recomputes when actually read after a dependency has changed.
 *
 * Design: The computed does NOT use the scheduler for its own
 * re-evaluation. When a dependency changes, it marks itself dirty
 * and triggers downstream subscribers (which ARE scheduled).
 * The actual re-evaluation happens lazily on `.value` access.
 *
 * Inspired by Vue 3 computed(), Solid createMemo().
 */

import { type Dep, track, trigger, ReactiveEffect } from "./effect.ts";

// ─── Computed interface ────────────────────────────────────

export interface Computed<T> {
  /** Read the computed value (lazy evaluation, cached). */
  readonly value: T;

  /** Read without tracking. */
  peek(): T;
}

// Brand for type-checking
const COMPUTED_BRAND = Symbol("sjs:computed");

// ─── Implementation ────────────────────────────────────────

class ComputedImpl<T> implements Computed<T>, Dep {
  [COMPUTED_BRAND] = true;

  subscribers = new Set<ReactiveEffect>();

  _value!: T;
  _dirty = true;
  _effect: ReactiveEffect;

  constructor(getter: () => T) {
    const self = this;

    // Internal effect solely for dependency tracking.
    // The fn wraps the getter — it writes to self._value as a side effect.
    this._effect = new ReactiveEffect(() => {
      self._value = getter();
    });

    // Override notify: don't schedule this effect via the scheduler.
    // Instead mark dirty and propagate to our own subscribers.
    this._effect.notify = function () {
      if (!self._dirty) {
        self._dirty = true;
        trigger(self);
      }
    };

    // Run once synchronously to establish deps and cache initial value
    this._effect.run();
    this._dirty = false;
  }

  get value(): T {
    track(this);

    if (this._dirty) {
      this._effect.run();
      this._dirty = false;
    }

    return this._value;
  }

  peek(): T {
    if (this._dirty) {
      this._effect.run();
      this._dirty = false;
    }
    return this._value;
  }

  /**
   * toString() for template interpolation.
   */
  toString(): string {
    return String(this.value);
  }

  /**
   * valueOf() for numeric operations.
   */
  valueOf(): T {
    return this.value;
  }
}

// ─── Public API ────────────────────────────────────────────

/**
 * Create a computed reactive value.
 *
 * The getter function is tracked — when any signal it reads changes,
 * the computed is marked dirty and will re-evaluate on next `.value` read.
 *
 * @example
 * const count = signal(2);
 * const doubled = computed(() => count.value * 2);
 *
 * console.log(doubled.value); // 4
 *
 * count.value = 5;
 * console.log(doubled.value); // 10
 */
export function computed<T>(getter: () => T): Computed<T> {
  return new ComputedImpl(getter);
}

/**
 * Type guard: check if a value is a Computed.
 */
export function isComputed(value: unknown): value is Computed<unknown> {
  return (
    value != null &&
    typeof value === "object" &&
    COMPUTED_BRAND in (value as any)
  );
}
