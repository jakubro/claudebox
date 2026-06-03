/** Numeric clamp helper. */

/** Clamp `value` to the inclusive `[min, max]` range. */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
