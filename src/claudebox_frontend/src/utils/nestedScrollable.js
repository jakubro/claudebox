/** Detect whether a scrollable ancestor between target and boundary consumes a scroll gesture. */

/**
 * Walk from event.target up to (but not including) boundaryEl. True when an ancestor is scrollable
 * along the wheel's axis with room left, so it consumes the gesture and raises no user intent.
 */
export function isNestedScrollableConsuming(event, boundaryEl, deltaX, deltaY) {
  let node = event.target
  while (node && node !== boundaryEl && node.nodeType === 1) {
    const style = window.getComputedStyle(node)
    const scrollableY = style.overflowY === 'auto' || style.overflowY === 'scroll'
    const scrollableX = style.overflowX === 'auto' || style.overflowX === 'scroll'

    if (scrollableY && deltaY !== 0) {
      const roomDown = node.scrollTop + node.clientHeight < node.scrollHeight - 1
      const roomUp = node.scrollTop > 0
      if ((deltaY > 0 && roomDown) || (deltaY < 0 && roomUp)) {
        return true
      }
    }
    if (scrollableX && deltaX !== 0) {
      const roomRight = node.scrollLeft + node.clientWidth < node.scrollWidth - 1
      const roomLeft = node.scrollLeft > 0
      if ((deltaX > 0 && roomRight) || (deltaX < 0 && roomLeft)) {
        return true
      }
    }
    node = node.parentElement
  }
  return false
}

/**
 * Coarse variant of isNestedScrollableConsuming for touch, where no delta is available: true when
 * any ancestor declares overflow auto/scroll, since touch panning routes to the innermost one.
 */
export function hasNestedScrollableAncestor(event, boundaryEl) {
  let node = event.target
  while (node && node !== boundaryEl && node.nodeType === 1) {
    const style = window.getComputedStyle(node)
    if (
      style.overflowY === 'auto' ||
      style.overflowY === 'scroll' ||
      style.overflowX === 'auto' ||
      style.overflowX === 'scroll'
    ) {
      return true
    }
    node = node.parentElement
  }
  return false
}
