/** A quote's copy text: one level of quote markers removed from its markdown source, an alert's marker too. */

const MARKER = /^[ \t]*>[ ]?/

/**
 * Strip the quote's own `>` from `source`, which starts at that marker. Later lines carry every
 * enclosing quote's marker too, so they lose up to `depth` of them; a lazy line keeps what it has.
 * @param {string} source - The quote's source span
 * @param {number} depth - This quote plus its quote ancestors
 */
export function stripQuoteMarkers(source, depth) {
  return source
    .split('\n')
    .map((line, i) => {
      let rest = line
      for (let level = 0; level < (i === 0 ? 1 : depth) && MARKER.test(rest); level++) {
        rest = rest.replace(MARKER, '')
      }
      return rest
    })
    .join('\n')
}

/** Drop an alert's first line, its [!KIND] marker, from its stripped source. */
export function dropAlertMarker(text) {
  const newline = text.indexOf('\n')
  return newline === -1 ? '' : text.slice(newline + 1)
}
