/**
 * SinwanJS Reactivity — Batch
 *
 * Batch multiple signal updates into a single synchronous flush.
 * Without batch(), each signal write schedules a microtask flush.
 * With batch(), all writes are collected and effects run once at the end.
 */

import { flushSync } from "./scheduler.ts";

let batchDepth = 0;
let batchScheduled = false;

/**
 * Batch multiple signal writes so effects run only once.
 *
 * @example
 * const a = signal(1);
 * const b = signal(2);
 *
 * // Without batch — effect runs twice (once per signal change)
 * // With batch — effect runs once after both changes
 * batch(() => {
 *   a.value = 10;
 *   b.value = 20;
 * });
 */
export function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      // Flush all pending effects synchronously
      flushSync();
    }
  }
}

/**
 * Returns true if currently inside a batch() call.
 */
export function isBatching(): boolean {
  return batchDepth > 0;
}
