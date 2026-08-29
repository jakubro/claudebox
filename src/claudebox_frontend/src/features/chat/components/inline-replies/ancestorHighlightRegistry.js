/** Shared coordinator for the ancestor read-only quote highlight, keyed per contributor. */

// CSS Custom Highlights are one document-global registry per name, and the live group already
// owns 'inline-quote'. Ancestors share a second name, since each would overwrite the others.
export const ANCESTOR_HIGHLIGHT_NAME = 'inline-quote-ancestor'

const HIGHLIGHTS_SUPPORTED =
  typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && 'highlights' in CSS

const contributions = new Map() // contributorId -> Range[]

function repaint() {
  if (!HIGHLIGHTS_SUPPORTED) {
    return
  }

  const allRanges = [...contributions.values()].flat()

  if (allRanges.length > 0) {
    CSS.highlights.set(ANCESTOR_HIGHLIGHT_NAME, new Highlight(...allRanges))
  } else {
    CSS.highlights.delete(ANCESTOR_HIGHLIGHT_NAME)
  }
}

/** Replace one contributor's ranges (an empty array clears it) and repaint the union. */
export function setAncestorHighlightRanges(contributorId, ranges) {
  if (ranges.length > 0) {
    contributions.set(contributorId, ranges)
  } else {
    contributions.delete(contributorId)
  }

  repaint()
}

/** Drop a contributor entirely (unmount) and repaint the union. */
export function clearAncestorHighlightRanges(contributorId) {
  contributions.delete(contributorId)
  repaint()
}
