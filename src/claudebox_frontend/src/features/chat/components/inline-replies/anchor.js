/** Text-quote anchoring: locate a quoted span within a turn across markdown re-render and reload, using the turn's RENDERED text (canonicalTurnText, not raw markdown) as the coordinate space so highlight offsets survive re-renders. */

// Quotable text = assistant/user prose and code, tool output (`.tool-details`), and expanded thinking
// (`.thinking-content-inline`). Excluded: code-block line-number gutters (`user-select: none`, so a real
// selection never includes them - keeping canonicalTurnText in sync with `range.toString()`), SVG/image
// media (e.g. Mermaid labels), copy buttons, system-reminder chrome, and any button. Shared with
// useSelectionQuote so the selection gate and the anchor coordinate space stay in lockstep.
export const INCLUDE_SELECTOR =
  '.turn-text, .message-content, .tool-details, .thinking-content-inline'
export const EXCLUDE_SELECTOR =
  '.code-block-gutter, .turn-text-copy-btn, .message-copy-btn, .system-reminders, svg, img, button'

// Context window captured on each side of the quote to disambiguate repeats.
const CONTEXT_CHARS = 32

/**
 * Concatenate the quotable rendered text of a message role node into a single string.
 * @param {HTMLElement} roleEl - The `[data-testid="message-*"]` node.
 * @returns {{ text: string, nodes: Array<{ node: Text, start: number }> }}
 */
export function canonicalTurnText(roleEl) {
  const walker = document.createTreeWalker(roleEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement

      if (!el?.closest(INCLUDE_SELECTOR) || el.closest(EXCLUDE_SELECTOR)) {
        return NodeFilter.FILTER_REJECT
      }

      return NodeFilter.FILTER_ACCEPT
    },
  })

  const nodes = []
  let text = ''

  while (walker.nextNode()) {
    nodes.push({ node: walker.currentNode, start: text.length })
    text += walker.currentNode.textContent
  }

  return { text, nodes }
}

/**
 * Capture a durable text-quote anchor from a live selection Range.
 * @param {Range} range - The selection range (may span inline-format boundaries).
 * @param {HTMLElement} roleEl - The message role node the selection belongs to.
 * @returns {{ quote: string, prefix: string, suffix: string, offset: number }|null}
 */
export function captureAnchor(range, roleEl) {
  const quote = range.toString()

  if (!quote.trim()) {
    return null
  }

  const { text, nodes } = canonicalTurnText(roleEl)
  const mapped = _offsetOf(nodes, range.startContainer, range.startOffset)

  // Prefer the mapped start; fall back to a text search when the start node is
  // outside the canonical set (e.g. selection began in chrome).
  const offset = mapped != null ? mapped : text.indexOf(quote)

  if (offset < 0) {
    return null
  }

  return {
    quote,
    prefix: text.slice(Math.max(0, offset - CONTEXT_CHARS), offset),
    suffix: text.slice(offset + quote.length, offset + quote.length + CONTEXT_CHARS),
    offset,
  }
}

/**
 * Relocate an anchored span within a turn, returning a Range or null when unresolvable.
 *
 * Tries the fully-qualified `prefix+quote+suffix` first (unique wins, else offset-nearest),
 * then relaxes to one-sided context, then a bare quote match. Returns null when the quote text
 * is gone entirely (source content changed) so the caller can pin a "source moved" thread.
 * @param {{ quote: string, prefix: string, suffix: string, offset: number }} anchor
 * @param {HTMLElement} roleEl
 * @returns {Range|null}
 */
export function resolveAnchor(anchor, roleEl) {
  const { quote } = anchor

  if (!quote) {
    return null
  }

  const { text, nodes } = canonicalTurnText(roleEl)

  const starts = _candidateStarts(text, anchor)

  if (starts.length === 0) {
    return null
  }

  const start = _pickNearest(starts, anchor.offset)

  return _rangeAt(nodes, start, start + quote.length)
}

/** Offset of a (container, containerOffset) selection boundary within the canonical text, or null. */
function _offsetOf(nodes, container, containerOffset) {
  for (const entry of nodes) {
    if (entry.node === container) {
      return entry.start + containerOffset
    }
  }

  return null
}

/** All plausible start offsets for the quote, most-qualified context first. */
function _candidateStarts(text, { quote, prefix, suffix }) {
  const withBoth = _allIndexes(text, prefix + quote + suffix).map(i => i + prefix.length)

  if (withBoth.length > 0) {
    return withBoth
  }

  const withPrefix = _allIndexes(text, prefix + quote).map(i => i + prefix.length)
  const withSuffix = _allIndexes(text, quote + suffix)
  const relaxed = [...withPrefix, ...withSuffix]

  if (relaxed.length > 0) {
    return relaxed
  }

  return _allIndexes(text, quote)
}

/** Every start index of `needle` in `haystack` (empty needle yields nothing). */
function _allIndexes(haystack, needle) {
  if (!needle) {
    return []
  }

  const out = []
  let from = 0

  while (true) {
    const at = haystack.indexOf(needle, from)

    if (at < 0) {
      break
    }

    out.push(at)
    from = at + 1
  }

  return out
}

/** The candidate start closest to the original capture offset (stable tiebreak). */
function _pickNearest(starts, offset) {
  return starts.reduce((best, s) => (Math.abs(s - offset) < Math.abs(best - offset) ? s : best))
}

/** Build a DOM Range spanning [start, end) of the canonical text across its text nodes. */
function _rangeAt(nodes, start, end) {
  const startPos = _positionAt(nodes, start)
  const endPos = _positionAt(nodes, end)

  if (!(startPos && endPos)) {
    return null
  }

  const range = document.createRange()
  range.setStart(startPos.node, startPos.off)
  range.setEnd(endPos.node, endPos.off)

  return range
}

/** Map a canonical offset back to a (text node, node-local offset) position. */
function _positionAt(nodes, offset) {
  for (const entry of nodes) {
    const len = entry.node.textContent.length

    if (offset <= entry.start + len) {
      return { node: entry.node, off: offset - entry.start }
    }
  }

  const last = nodes[nodes.length - 1]

  return last ? { node: last.node, off: last.node.textContent.length } : null
}
