/** Geometry helpers for the inline-threads overlay: highlight hit-testing, span positioning, collision. */

/**
 * Whether a viewport point falls inside any client rect of the range (highlight hover/click hit-test).
 * @param {Range} range
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function rangeContainsPoint(range, x, y) {
  for (const rect of range.getClientRects()) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return true
    }
  }

  return false
}

/**
 * The last client rect of a range (the end of the quoted span), or null when the range paints nothing
 * (e.g. its source turn is collapsed to zero height). Used to pin a float at the selection end.
 * @param {Range} range
 * @returns {DOMRect|null}
 */
export function spanRect(range) {
  const rects = range.getClientRects()

  if (rects.length === 0) {
    return null
  }

  return rects[rects.length - 1]
}

/**
 * Whether a range's text is currently visible - not hidden by a collapsed ancestor. Auto-collapse hides
 * a turn via `visibility: hidden; height: 0`, under which the range still reports a non-zero client rect,
 * so geometry can't detect it; computed (inherited) visibility can.
 * @param {Range} range
 * @returns {boolean}
 */
export function isRangeVisible(range) {
  const node = range.startContainer
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node

  return !!el && getComputedStyle(el).visibility !== 'hidden'
}

/**
 * Resolve vertical collisions among open floats: a box whose horizontal band overlaps an already-placed
 * one is pushed below it, so pinned floats never cover each other. Pure - desired rects in, adjusted
 * { left, top } per id out (boxes with independent horizontal bands keep their desired position).
 * @param {Array<{id: string, left: number, top: number, width: number, height: number}>} boxes
 * @param {number} [gap] - Minimum vertical gap between stacked boxes.
 * @returns {Map<string, {left: number, top: number}>}
 */
export function stackFloats(boxes, gap = 8) {
  const sorted = [...boxes].sort((a, b) => a.top - b.top)
  const placed = []
  const out = new Map()

  for (const box of sorted) {
    let top = box.top

    for (const prev of placed) {
      const overlapsHorizontally =
        box.left < prev.left + prev.width && prev.left < box.left + box.width

      if (overlapsHorizontally && top < prev.top + prev.height + gap) {
        top = prev.top + prev.height + gap
      }
    }

    placed.push({ ...box, top })
    out.set(box.id, { left: box.left, top })
  }

  return out
}

/**
 * Whether two id -> { left, top } position maps are equal (guards the reposition render loop).
 * @param {Map<string, {left: number, top: number}>} a
 * @param {Map<string, {left: number, top: number}>} b
 * @returns {boolean}
 */
export function positionsEqual(a, b) {
  if (a.size !== b.size) {
    return false
  }

  for (const [id, pos] of a) {
    const other = b.get(id)

    if (!other || other.left !== pos.left || other.top !== pos.top) {
      return false
    }
  }

  return true
}
