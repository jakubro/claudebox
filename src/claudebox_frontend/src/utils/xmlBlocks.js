/** XML block parsing utilities for collapse/expand operations. */

/** Match opening XML tags. */
export const OPEN_TAG_RE = /<([a-zA-Z][a-zA-Z0-9_-]*)>/g

/** Match a collapsed placeholder (with sequence number). */
export const COLLAPSED_RE = /<([a-zA-Z][a-zA-Z0-9_-]*)\.\.\.(\d+)>/g

/**
 * Find all XML blocks (open+close pairs) in value.
 *
 * Tracks nesting depth for same-name tags to find the correct closing match.
 */
export function findAllBlocks(value) {
  const blocks = []
  OPEN_TAG_RE.lastIndex = 0
  let match
  while ((match = OPEN_TAG_RE.exec(value)) !== null) {
    const tagName = match[1]
    const start = match.index
    const openTag = `<${tagName}>`
    const closeTag = `</${tagName}>`

    let depth = 1
    let searchFrom = start + match[0].length
    while (depth > 0) {
      const nextOpen = value.indexOf(openTag, searchFrom)
      const nextClose = value.indexOf(closeTag, searchFrom)
      if (nextClose === -1) {
        break
      }
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++
        searchFrom = nextOpen + openTag.length
      } else {
        depth--
        if (depth === 0) {
          const end = nextClose + closeTag.length
          blocks.push({ start, end, tagName, fullMatch: value.slice(start, end) })
        } else {
          searchFrom = nextClose + closeTag.length
        }
      }
    }
  }
  return blocks
}

/**
 * Find the innermost XML block enclosing the cursor position.
 *
 * Returns { start, end, tagName, fullMatch } or null.
 */
export function findEnclosingBlock(value, cursor) {
  let best = null
  for (const block of findAllBlocks(value)) {
    if (cursor >= block.start && cursor <= block.end) {
      if (!best || block.end - block.start < best.end - best.start) {
        best = block
      }
    }
  }
  return best
}

/**
 * Find the collapsed placeholder nearest to the cursor.
 *
 * Returns { start, end, tagName, placeholder } or null.
 */
export function findEnclosingCollapsed(value, cursor) {
  let best = null
  let bestDist = Infinity
  COLLAPSED_RE.lastIndex = 0
  let match
  while ((match = COLLAPSED_RE.exec(value)) !== null) {
    const start = match.index
    const end = start + match[0].length
    const dist =
      cursor >= start && cursor <= end
        ? 0
        : Math.min(Math.abs(cursor - start), Math.abs(cursor - end))
    if (dist < bestDist) {
      bestDist = dist
      best = { start, end, tagName: match[1], placeholder: match[0] }
    }
  }
  // Only return if cursor is inside or adjacent to the placeholder
  if (best && bestDist <= 0) {
    return best
  }
  return null
}
