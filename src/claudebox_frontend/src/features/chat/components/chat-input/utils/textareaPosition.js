/** Pure textarea position primitives - line offsets and leading-whitespace counts. */

/** Index of the line start at or before pos. Returns 0 when no preceding newline. */
export function lineStartOffset(value, pos) {
  const idx = value.lastIndexOf('\n', pos - 1)
  return idx === -1 ? 0 : idx + 1
}

/** Index of the line end at or after pos. Returns value.length when no following newline. */
export function lineEndOffset(value, pos) {
  const idx = value.indexOf('\n', pos)
  return idx === -1 ? value.length : idx
}

/** Count of leading [space|tab] characters at lineStart. */
export function leadingWhitespaceLen(value, lineStart) {
  let i = lineStart
  while (i < value.length && (value[i] === ' ' || value[i] === '\t')) {
    i++
  }
  return i - lineStart
}
