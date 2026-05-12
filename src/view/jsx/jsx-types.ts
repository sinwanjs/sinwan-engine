/**
 * SinwanJS View Module — JSX Type Definitions
 *
 * Strongly-typed HTML attribute interfaces for the JSX IntrinsicElements map.
 * Supports both React-style (`className`) and native (`class`) attribute names.
 */

import type { SjsElement, SjsNode } from "../types";

// ---------------------------------------------------------------------------
// Event handler types
// ---------------------------------------------------------------------------

type EventHandler<E = Event> = string | ((event: E) => void);

// ---------------------------------------------------------------------------
// Style type
// ---------------------------------------------------------------------------

type CSSProperties = Record<string, string | number> | string;

// ---------------------------------------------------------------------------
// Base HTML attributes (shared by every element)
// ---------------------------------------------------------------------------

export interface HTMLAttributes {
  // Identity
  id?: string;
  key?: string | number;

  // Class — both native `class` and React-compat `className`
  class?: string;
  className?: string;

  // Style — inline CSS object or string
  style?: CSSProperties;

  // Content
  title?: string;
  lang?: string;
  dir?: "ltr" | "rtl" | "auto";
  hidden?: boolean;
  tabindex?: number | string;
  tabIndex?: number | string;
  slot?: string;

  // Accessibility
  role?: string;

  // Editing
  contenteditable?: boolean | "true" | "false" | "plaintext-only";
  contentEditable?: boolean | "true" | "false" | "plaintext-only";
  draggable?: boolean | "true" | "false";
  spellcheck?: boolean | "true" | "false";

  // Misc
  translate?: "yes" | "no";
  is?: string;
  inputmode?: "none" | "text" | "decimal" | "numeric" | "tel" | "search" | "email" | "url";
  inputMode?: "none" | "text" | "decimal" | "numeric" | "tel" | "search" | "email" | "url";
  enterkeyhint?: "enter" | "done" | "go" | "next" | "previous" | "search" | "send";
  popover?: boolean | "auto" | "manual";
  autofocus?: boolean;
  autoFocus?: boolean;
  nonce?: string;

  // SJS-specific: raw HTML injection (trusted only)
  dangerouslySetInnerHTML?: { __html: string };

  // Children
  children?: SjsNode;

  // ---------- Aria attributes (permissive prefix) ----------
  "aria-activedescendant"?: string;
  "aria-atomic"?: boolean | "true" | "false";
  "aria-autocomplete"?: "none" | "inline" | "list" | "both";
  "aria-busy"?: boolean | "true" | "false";
  "aria-checked"?: boolean | "true" | "false" | "mixed";
  "aria-colcount"?: number;
  "aria-colindex"?: number;
  "aria-colspan"?: number;
  "aria-controls"?: string;
  "aria-current"?: boolean | "true" | "false" | "page" | "step" | "location" | "date" | "time";
  "aria-describedby"?: string;
  "aria-details"?: string;
  "aria-disabled"?: boolean | "true" | "false";
  "aria-dropeffect"?: "none" | "copy" | "execute" | "link" | "move" | "popup";
  "aria-errormessage"?: string;
  "aria-expanded"?: boolean | "true" | "false";
  "aria-flowto"?: string;
  "aria-grabbed"?: boolean | "true" | "false";
  "aria-haspopup"?: boolean | "true" | "false" | "menu" | "listbox" | "tree" | "grid" | "dialog";
  "aria-hidden"?: boolean | "true" | "false";
  "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
  "aria-keyshortcuts"?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-level"?: number;
  "aria-live"?: "off" | "assertive" | "polite";
  "aria-modal"?: boolean | "true" | "false";
  "aria-multiline"?: boolean | "true" | "false";
  "aria-multiselectable"?: boolean | "true" | "false";
  "aria-orientation"?: "horizontal" | "vertical";
  "aria-owns"?: string;
  "aria-placeholder"?: string;
  "aria-posinset"?: number;
  "aria-pressed"?: boolean | "true" | "false" | "mixed";
  "aria-readonly"?: boolean | "true" | "false";
  "aria-relevant"?: "additions" | "all" | "removals" | "text" | "additions text";
  "aria-required"?: boolean | "true" | "false";
  "aria-roledescription"?: string;
  "aria-rowcount"?: number;
  "aria-rowindex"?: number;
  "aria-rowspan"?: number;
  "aria-selected"?: boolean | "true" | "false";
  "aria-setsize"?: number;
  "aria-sort"?: "none" | "ascending" | "descending" | "other";
  "aria-valuemax"?: number;
  "aria-valuemin"?: number;
  "aria-valuenow"?: number;
  "aria-valuetext"?: string;

  // ---------- Event handlers (SSR renders these as attribute strings) ----------
  onclick?: EventHandler;
  ondblclick?: EventHandler;
  onmousedown?: EventHandler;
  onmouseup?: EventHandler;
  onmouseover?: EventHandler;
  onmouseout?: EventHandler;
  onmousemove?: EventHandler;
  onmouseenter?: EventHandler;
  onmouseleave?: EventHandler;
  onkeydown?: EventHandler;
  onkeyup?: EventHandler;
  onkeypress?: EventHandler;
  onfocus?: EventHandler;
  onblur?: EventHandler;
  onchange?: EventHandler;
  oninput?: EventHandler;
  onsubmit?: EventHandler;
  onreset?: EventHandler;
  onscroll?: EventHandler;
  onwheel?: EventHandler;
  onload?: EventHandler;
  onerror?: EventHandler;
  onresize?: EventHandler;

  // Data-* and custom attributes
  [key: `data-${string}`]: string | number | boolean | undefined;
}

// ---------------------------------------------------------------------------
// Per-element attribute extensions
// ---------------------------------------------------------------------------

export interface AnchorHTMLAttributes extends HTMLAttributes {
  href?: string;
  target?: "_self" | "_blank" | "_parent" | "_top" | string;
  rel?: string;
  download?: string | boolean;
  hreflang?: string;
  ping?: string;
  referrerpolicy?: string;
  referrerPolicy?: string;
  type?: string;
}

export interface ImgHTMLAttributes extends HTMLAttributes {
  src?: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  loading?: "eager" | "lazy";
  decoding?: "sync" | "async" | "auto";
  crossorigin?: "" | "anonymous" | "use-credentials";
  crossOrigin?: "" | "anonymous" | "use-credentials";
  srcset?: string;
  srcSet?: string;
  sizes?: string;
  fetchpriority?: "high" | "low" | "auto";
  usemap?: string;
  ismap?: boolean;
}

export interface InputHTMLAttributes extends HTMLAttributes {
  type?: string;
  name?: string;
  value?: string | number | readonly string[];
  checked?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  readOnly?: boolean;
  required?: boolean;
  placeholder?: string;
  maxlength?: number | string;
  maxLength?: number | string;
  minlength?: number | string;
  minLength?: number | string;
  max?: number | string;
  min?: number | string;
  step?: number | string;
  pattern?: string;
  multiple?: boolean;
  accept?: string;
  autocomplete?: string;
  autoComplete?: string;
  list?: string;
  size?: number | string;
  src?: string;
  alt?: string;
  width?: number | string;
  height?: number | string;
  form?: string;
  formaction?: string;
  formAction?: string;
  formmethod?: string;
  formMethod?: string;
  formnovalidate?: boolean;
  formNoValidate?: boolean;
  formtarget?: string;
  formTarget?: string;
  capture?: "user" | "environment" | string;
}

export interface TextareaHTMLAttributes extends HTMLAttributes {
  name?: string;
  value?: string;
  disabled?: boolean;
  readonly?: boolean;
  readOnly?: boolean;
  required?: boolean;
  placeholder?: string;
  rows?: number | string;
  cols?: number | string;
  maxlength?: number | string;
  maxLength?: number | string;
  minlength?: number | string;
  minLength?: number | string;
  wrap?: "hard" | "soft" | "off";
  autocomplete?: string;
  autoComplete?: string;
  form?: string;
}

export interface SelectHTMLAttributes extends HTMLAttributes {
  name?: string;
  value?: string | readonly string[];
  disabled?: boolean;
  required?: boolean;
  multiple?: boolean;
  size?: number | string;
  form?: string;
  autocomplete?: string;
  autoComplete?: string;
}

export interface OptionHTMLAttributes extends HTMLAttributes {
  value?: string | number;
  disabled?: boolean;
  selected?: boolean;
  label?: string;
}

export interface FormHTMLAttributes extends HTMLAttributes {
  action?: string;
  method?: "get" | "post" | "dialog" | string;
  enctype?: string;
  encType?: string;
  target?: string;
  novalidate?: boolean;
  noValidate?: boolean;
  autocomplete?: "on" | "off" | string;
  autoComplete?: "on" | "off" | string;
  name?: string;
  acceptCharset?: string;
  "accept-charset"?: string;
}

export interface ButtonHTMLAttributes extends HTMLAttributes {
  type?: "submit" | "reset" | "button";
  name?: string;
  value?: string;
  disabled?: boolean;
  form?: string;
  formaction?: string;
  formAction?: string;
  formmethod?: string;
  formMethod?: string;
  formnovalidate?: boolean;
  formNoValidate?: boolean;
  formtarget?: string;
  formTarget?: string;
  popovertarget?: string;
  popovertargetaction?: "hide" | "show" | "toggle";
}

export interface LabelHTMLAttributes extends HTMLAttributes {
  for?: string;
  htmlFor?: string;
  form?: string;
}

export interface TableHTMLAttributes extends HTMLAttributes {
  cellpadding?: number | string;
  cellspacing?: number | string;
  border?: number | string;
  width?: number | string;
}

export interface TdHTMLAttributes extends HTMLAttributes {
  colspan?: number | string;
  colSpan?: number | string;
  rowspan?: number | string;
  rowSpan?: number | string;
  headers?: string;
  scope?: "row" | "col" | "rowgroup" | "colgroup";
}

export interface ThHTMLAttributes extends TdHTMLAttributes {
  abbr?: string;
}

export interface MetaHTMLAttributes extends HTMLAttributes {
  charset?: string;
  content?: string;
  "http-equiv"?: string;
  httpEquiv?: string;
  name?: string;
  media?: string;
}

export interface LinkHTMLAttributes extends HTMLAttributes {
  href?: string;
  rel?: string;
  type?: string;
  media?: string;
  crossorigin?: "" | "anonymous" | "use-credentials";
  crossOrigin?: "" | "anonymous" | "use-credentials";
  integrity?: string;
  as?: string;
  sizes?: string;
  hreflang?: string;
  fetchpriority?: "high" | "low" | "auto";
  disabled?: boolean;
}

export interface ScriptHTMLAttributes extends HTMLAttributes {
  src?: string;
  type?: string;
  async?: boolean;
  defer?: boolean;
  crossorigin?: "" | "anonymous" | "use-credentials";
  crossOrigin?: "" | "anonymous" | "use-credentials";
  integrity?: string;
  nomodule?: boolean;
  noModule?: boolean;
  nonce?: string;
  fetchpriority?: "high" | "low" | "auto";
}

export interface StyleHTMLAttributes extends HTMLAttributes {
  media?: string;
  nonce?: string;
  type?: string;
}

export interface IframeHTMLAttributes extends HTMLAttributes {
  src?: string;
  srcdoc?: string;
  name?: string;
  width?: number | string;
  height?: number | string;
  sandbox?: string;
  allow?: string;
  allowfullscreen?: boolean;
  loading?: "eager" | "lazy";
  referrerpolicy?: string;
  referrerPolicy?: string;
}

export interface VideoHTMLAttributes extends HTMLAttributes {
  src?: string;
  poster?: string;
  width?: number | string;
  height?: number | string;
  autoplay?: boolean;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
  playsinline?: boolean;
  preload?: "none" | "metadata" | "auto" | "";
  crossorigin?: "" | "anonymous" | "use-credentials";
  crossOrigin?: "" | "anonymous" | "use-credentials";
}

export interface AudioHTMLAttributes extends HTMLAttributes {
  src?: string;
  autoplay?: boolean;
  controls?: boolean;
  loop?: boolean;
  muted?: boolean;
  preload?: "none" | "metadata" | "auto" | "";
  crossorigin?: "" | "anonymous" | "use-credentials";
  crossOrigin?: "" | "anonymous" | "use-credentials";
}

export interface SourceHTMLAttributes extends HTMLAttributes {
  src?: string;
  srcset?: string;
  srcSet?: string;
  sizes?: string;
  type?: string;
  media?: string;
  width?: number | string;
  height?: number | string;
}

export interface CanvasHTMLAttributes extends HTMLAttributes {
  width?: number | string;
  height?: number | string;
}

export interface DialogHTMLAttributes extends HTMLAttributes {
  open?: boolean;
}

export interface DetailsHTMLAttributes extends HTMLAttributes {
  open?: boolean;
  name?: string;
}

export interface HtmlHTMLAttributes extends HTMLAttributes {
  lang?: string;
  xmlns?: string;
}

export interface ColHTMLAttributes extends HTMLAttributes {
  span?: number | string;
  width?: number | string;
}

export interface ColgroupHTMLAttributes extends HTMLAttributes {
  span?: number | string;
}

export interface OutputHTMLAttributes extends HTMLAttributes {
  for?: string;
  htmlFor?: string;
  form?: string;
  name?: string;
}

export interface MeterHTMLAttributes extends HTMLAttributes {
  value?: number | string;
  min?: number | string;
  max?: number | string;
  low?: number | string;
  high?: number | string;
  optimum?: number | string;
  form?: string;
}

export interface ProgressHTMLAttributes extends HTMLAttributes {
  value?: number | string;
  max?: number | string;
}

export interface TimeHTMLAttributes extends HTMLAttributes {
  datetime?: string;
  dateTime?: string;
}

export interface SvgHTMLAttributes extends HTMLAttributes {
  viewBox?: string;
  xmlns?: string;
  fill?: string;
  stroke?: string;
  "stroke-width"?: number | string;
  "stroke-linecap"?: string;
  "stroke-linejoin"?: string;
  width?: number | string;
  height?: number | string;
  d?: string;
  cx?: number | string;
  cy?: number | string;
  r?: number | string;
  x?: number | string;
  y?: number | string;
  x1?: number | string;
  y1?: number | string;
  x2?: number | string;
  y2?: number | string;
  rx?: number | string;
  ry?: number | string;
  transform?: string;
  opacity?: number | string;
  "clip-path"?: string;
  points?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// IntrinsicElements map
// ---------------------------------------------------------------------------

export interface SjsIntrinsicElements {
  // Document
  html: HtmlHTMLAttributes;
  head: HTMLAttributes;
  body: HTMLAttributes;
  title: HTMLAttributes;
  base: HTMLAttributes & { href?: string; target?: string };

  // Metadata
  meta: MetaHTMLAttributes;
  link: LinkHTMLAttributes;
  style: StyleHTMLAttributes;
  script: ScriptHTMLAttributes;
  noscript: HTMLAttributes;

  // Sections
  header: HTMLAttributes;
  footer: HTMLAttributes;
  main: HTMLAttributes;
  nav: HTMLAttributes;
  aside: HTMLAttributes;
  section: HTMLAttributes;
  article: HTMLAttributes;
  address: HTMLAttributes;
  hgroup: HTMLAttributes;
  search: HTMLAttributes;

  // Headings
  h1: HTMLAttributes;
  h2: HTMLAttributes;
  h3: HTMLAttributes;
  h4: HTMLAttributes;
  h5: HTMLAttributes;
  h6: HTMLAttributes;

  // Text content
  p: HTMLAttributes;
  div: HTMLAttributes;
  span: HTMLAttributes;
  br: HTMLAttributes;
  hr: HTMLAttributes;
  pre: HTMLAttributes;
  blockquote: HTMLAttributes & { cite?: string };
  ol: HTMLAttributes & { start?: number; reversed?: boolean; type?: "1" | "a" | "A" | "i" | "I" };
  ul: HTMLAttributes;
  li: HTMLAttributes & { value?: number };
  dl: HTMLAttributes;
  dt: HTMLAttributes;
  dd: HTMLAttributes;
  figure: HTMLAttributes;
  figcaption: HTMLAttributes;

  // Inline text
  a: AnchorHTMLAttributes;
  em: HTMLAttributes;
  strong: HTMLAttributes;
  small: HTMLAttributes;
  s: HTMLAttributes;
  cite: HTMLAttributes;
  q: HTMLAttributes & { cite?: string };
  dfn: HTMLAttributes;
  abbr: HTMLAttributes;
  ruby: HTMLAttributes;
  rt: HTMLAttributes;
  rp: HTMLAttributes;
  code: HTMLAttributes;
  var: HTMLAttributes;
  samp: HTMLAttributes;
  kbd: HTMLAttributes;
  sub: HTMLAttributes;
  sup: HTMLAttributes;
  i: HTMLAttributes;
  b: HTMLAttributes;
  u: HTMLAttributes;
  mark: HTMLAttributes;
  bdi: HTMLAttributes;
  bdo: HTMLAttributes & { dir: "ltr" | "rtl" };
  wbr: HTMLAttributes;

  // Forms
  form: FormHTMLAttributes;
  input: InputHTMLAttributes;
  textarea: TextareaHTMLAttributes;
  select: SelectHTMLAttributes;
  option: OptionHTMLAttributes;
  optgroup: HTMLAttributes & { disabled?: boolean; label: string };
  button: ButtonHTMLAttributes;
  label: LabelHTMLAttributes;
  fieldset: HTMLAttributes & { disabled?: boolean; form?: string; name?: string };
  legend: HTMLAttributes;
  datalist: HTMLAttributes;
  output: OutputHTMLAttributes;
  progress: ProgressHTMLAttributes;
  meter: MeterHTMLAttributes;

  // Tables
  table: TableHTMLAttributes;
  caption: HTMLAttributes;
  thead: HTMLAttributes;
  tbody: HTMLAttributes;
  tfoot: HTMLAttributes;
  tr: HTMLAttributes;
  td: TdHTMLAttributes;
  th: ThHTMLAttributes;
  col: ColHTMLAttributes;
  colgroup: ColgroupHTMLAttributes;

  // Media
  img: ImgHTMLAttributes;
  picture: HTMLAttributes;
  source: SourceHTMLAttributes;
  video: VideoHTMLAttributes;
  audio: AudioHTMLAttributes;
  track: HTMLAttributes & { src?: string; kind?: string; srclang?: string; label?: string; default?: boolean };
  map: HTMLAttributes & { name: string };
  area: HTMLAttributes & { href?: string; alt?: string; shape?: string; coords?: string; target?: string; rel?: string };
  canvas: CanvasHTMLAttributes;

  // Embedded
  iframe: IframeHTMLAttributes;
  embed: HTMLAttributes & { src?: string; type?: string; width?: number | string; height?: number | string };
  object: HTMLAttributes & { data?: string; type?: string; width?: number | string; height?: number | string; name?: string; form?: string };
  param: HTMLAttributes & { name?: string; value?: string };

  // Interactive
  details: DetailsHTMLAttributes;
  summary: HTMLAttributes;
  dialog: DialogHTMLAttributes;
  menu: HTMLAttributes;

  // Misc
  template: HTMLAttributes;
  slot: HTMLAttributes & { name?: string };
  time: TimeHTMLAttributes;
  data: HTMLAttributes & { value?: string };
  del: HTMLAttributes & { cite?: string; datetime?: string };
  ins: HTMLAttributes & { cite?: string; datetime?: string };

  // SVG (permissive)
  svg: SvgHTMLAttributes;
  path: SvgHTMLAttributes;
  circle: SvgHTMLAttributes;
  rect: SvgHTMLAttributes;
  line: SvgHTMLAttributes;
  polyline: SvgHTMLAttributes;
  polygon: SvgHTMLAttributes;
  ellipse: SvgHTMLAttributes;
  text: SvgHTMLAttributes;
  tspan: SvgHTMLAttributes;
  g: SvgHTMLAttributes;
  defs: SvgHTMLAttributes;
  use: SvgHTMLAttributes;
  symbol: SvgHTMLAttributes;
  clipPath: SvgHTMLAttributes;
  mask: SvgHTMLAttributes;
  image: SvgHTMLAttributes;
  linearGradient: SvgHTMLAttributes;
  radialGradient: SvgHTMLAttributes;
  stop: SvgHTMLAttributes;
  pattern: SvgHTMLAttributes;
  foreignObject: SvgHTMLAttributes;
  animate: SvgHTMLAttributes;
  animateTransform: SvgHTMLAttributes;
  filter: SvgHTMLAttributes;
  feGaussianBlur: SvgHTMLAttributes;
  feOffset: SvgHTMLAttributes;
  feBlend: SvgHTMLAttributes;
  feColorMatrix: SvgHTMLAttributes;
  feComposite: SvgHTMLAttributes;
}
