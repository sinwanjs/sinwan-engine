/**
 * SinwanJS View Module — Core Types
 *
 * Type definitions for the SJS component system.
 * Mirrors React's FC model but compiles to optimized string builders.
 */

import type { HtmlEscapedString } from "./jsx/jsx-runtime";

// Primitive node types that can be rendered
export type SjsPrimitive = string | number | boolean | null | undefined;

// Element structure returned by JSX
export interface SjsElement {
  tag: string | SjsComponent<any>;
  props: Record<string, unknown>;
  children: SjsNode[];
}

// Recursive node type
export type SjsNode =
  | SjsPrimitive
  | SjsElement
  | Promise<SjsElement>
  | HtmlEscapedString
  | SjsNode[];

// Named slots for advanced composition
export type SjsSlots = Record<string, SjsNode>;

// Component function type - single props argument with children injected
export interface SjsComponent<P extends object = {}> {
  (
    props: P & { children?: SjsNode | SjsSlots },
  ): SjsElement | Promise<SjsElement>;
  _sjsComponent?: true;
  _displayName?: string;
}

// Page function type - receives data object, returns element tree
export interface SjsPage<D extends object = {}> {
  (data: D): SjsElement | Promise<SjsElement>;
  _sjsPage?: true;
  _displayName?: string;
}

// Layout is just a component with children
export type SjsLayout<P extends object = {}> = SjsComponent<
  P & { children: SjsNode }
>;

// Render result can be sync or async
export type RenderResult = SjsElement | Promise<SjsElement>;

// Props with children helper
export type PropsWithChildren<P = {}> = P & { children?: SjsNode };

// Props with slots helper
export type PropsWithSlots<P = {}> = P & { children?: SjsSlots };

// Component registry entry
export interface PageEntry<D extends object = {}> {
  name: string;
  page: SjsPage<D>;
}
