/// <reference lib="dom" />

/**
 * SinwanJS Client Renderer — Types
 *
 * Type definitions for the client-side DOM renderer.
 */

import type { CleanupFn } from "../reactivity/index.ts";
import type { ComponentInstance } from "../component/instance.ts";

// ─── MountedNode ───────────────────────────────────────────

/** A static text node. */
export interface MountedText {
  type: "text";
  node: Text;
}

/** A reactive text node — updated by an effect when a signal changes. */
export interface MountedReactiveText {
  type: "reactive-text";
  node: Text;
  dispose: CleanupFn;
}

/** A mounted DOM element with its children. */
export interface MountedElement {
  type: "element";
  node: Element;
  children: MountedNode[];
  eventCleanups: CleanupFn[];
  /** Reactive attribute effects to dispose on unmount. */
  attrDisposers: CleanupFn[];
}

/** A fragment (multiple sibling nodes). */
export interface MountedFragment {
  type: "fragment";
  children: MountedNode[];
  /** Anchor comment node for positioning. */
  anchor: Comment;
}

/** A reactive block that swaps DOM when a signal changes (conditional/list). */
export interface MountedReactiveBlock {
  type: "reactive-block";
  dispose: CleanupFn;
  /** Current mounted children (replaced on re-render). */
  children: MountedNode[];
  /** Start anchor. */
  startAnchor: Comment;
  /** End anchor. */
  endAnchor: Comment;
}

/** A mounted component instance. */
export interface MountedComponent {
  type: "component";
  children: MountedNode[];
  disposers: CleanupFn[];
  /** The ComponentInstance for lifecycle hooks (null for anonymous renders). */
  instance: ComponentInstance | null;
}

/** Union of all mounted node types. */
export type MountedNode =
  | MountedText
  | MountedReactiveText
  | MountedElement
  | MountedFragment
  | MountedReactiveBlock
  | MountedComponent;

// ─── AppInstance ───────────────────────────────────────────

/** Handle returned by mount(). Allows unmounting the app. */
export interface AppInstance {
  /** The root mounted node tree. */
  root: MountedNode;
  /** Unmount the entire app — cleans up effects, events, and DOM. */
  unmount(): void;
}
