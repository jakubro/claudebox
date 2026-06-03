/** Pure string helpers. */

/** Capitalize the first character of a string; empty / falsy input returns ''. */
export function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}
