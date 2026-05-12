/**
 * SinwanJS Reactivity — Signal
 *
 * A signal is a reactive container for a single value.
 * Reading `.value` tracks the current effect as a subscriber.
 * Writing `.value` notifies all subscribers.
 *
 * Inspired by Vue 3 ref(), Solid signals, Preact signals.
 */

import { type Dep, track, trigger } from "./effect.ts";

// ─── Signal interface ──────────────────────────────────────

export interface Signal<T> {
  /** Get or set the reactive value. Reading tracks; writing notifies. */
  value: T;

  /** Read the value without tracking dependencies. */
  peek(): T;

  /** Manually subscribe to changes. Returns an unsubscribe function. */
  subscribe(fn: (value: T) => void): () => void;
}

// Brand for type-checking
const SIGNAL_BRAND = Symbol("sjs:signal");

// ─── Implementation ────────────────────────────────────────

class SignalImpl<T> implements Signal<T>, Dep {
  [SIGNAL_BRAND] = true;

  subscribers = new Set<import("./effect.ts").ReactiveEffect>();
  private _value: T;
  private _manualSubs = new Set<(value: T) => void>();

  constructor(initial: T) {
    this._value = initial;
  }

  get value(): T {
    track(this);
    return this._value;
  }

  set value(newValue: T) {
    if (Object.is(this._value, newValue)) return;
    this._value = newValue;
    trigger(this);

    // Notify manual subscribers
    for (const fn of this._manualSubs) {
      fn(newValue);
    }
  }

  peek(): T {
    return this._value;
  }

  subscribe(fn: (value: T) => void): () => void {
    this._manualSubs.add(fn);
    return () => {
      this._manualSubs.delete(fn);
    };
  }

  /**
   * toString() for interpolation in templates.
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
 * Create a reactive signal.
 *
 * @example
 * const count = signal(0);
 * console.log(count.value); // 0
 *
 * effect(() => {
 *   console.log(count.value); // re-runs when count changes
 * });
 *
 * count.value = 5; // triggers the effect
 */
export function signal<T>(initial: T): Signal<T> {
  return new SignalImpl(initial);
}

/**
 * Type guard: check if a value is a Signal.
 */
export function isSignal(value: unknown): value is Signal<unknown> {
  return (
    value != null &&
    typeof value === "object" &&
    SIGNAL_BRAND in (value as any)
  );
}
