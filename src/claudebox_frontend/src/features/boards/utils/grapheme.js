/** First-grapheme extraction for collapsed-column board headers. */

const segmenter =
  typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter('und', { granularity: 'grapheme' })
    : null

/**
 * Return the first grapheme cluster of `label`, uppercased when alphabetic.
 * Preserves multi-codepoint emoji (surrogate pairs, ZWJ sequences) and
 * combining marks intact. Falls back to `label[0]` when `Intl.Segmenter`
 * is unavailable.
 *
 * @param {string} label
 * @returns {string}
 */
export function firstGrapheme(label) {
  if (!label) {
    return ''
  }
  const first = segmenter ? ([...segmenter.segment(label)][0]?.segment ?? '') : label[0]
  if (!first) {
    return ''
  }
  return /^\p{L}/u.test(first) ? first.toUpperCase() : first
}
