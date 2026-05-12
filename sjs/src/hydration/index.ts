/**
 * SinwanJS Hydration — Public API
 */

export { hydrate } from "./hydrate.ts";

export {
  COMP_ID_ATTR,
  COMP_ID_PREFIX,
  TEXT_MARKER_OPEN,
  TEXT_MARKER_CLOSE,
  EVENT_ATTR,
  compId,
  textMarkerOpen,
  textMarkerCloseStr,
  eventAttrValue,
  parseTextOpenMarker,
  isTextCloseMarker,
  parseEventAttr,
  parseCompId,
} from "./markers.ts";

export type { HydrationCursor } from "./walk.ts";
