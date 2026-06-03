/** Pointer Events helpers shared across drag, click-vs-drag, and resize handlers. */

/** Pixel distance threshold above which a pointer gesture is treated as drag, not click. */
export const DRAG_THRESHOLD_PX = 5

/** Filter for the primary pointer of any input type (mouse, touch, pen). */
export function isPrimaryPointer(event) {
  return event.isPrimary !== false
}
