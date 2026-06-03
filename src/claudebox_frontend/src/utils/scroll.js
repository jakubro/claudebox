/** Scroll animation utilities. */

/**
 * Compute the scrollTop value `scrollToEdge` would write to align `target`'s
 * edge with `container`'s viewport edge. Used by `scrollToEdge` internally
 * and by callers that need to predict the post-scroll position without
 * actually scrolling (e.g. for an at-bottom predicate).
 *
 * Returns the raw computed destination — not clamped to scroll range. DOM
 * clamps scrollTop writes; callers that want the post-clamp position should
 * clamp against `[0, scrollHeight - clientHeight]` themselves.
 *
 * @param {HTMLElement} container
 * @param {HTMLElement} target
 * @param {'top' | 'bottom'} [edge='top']
 * @returns {number}
 */
export function computeScrollDestination(container, target, edge = 'top') {
  const targetRect = target.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()

  if (edge === 'top') {
    // Align target's top with container's top
    return targetRect.top - containerRect.top + container.scrollTop
  }
  // Align target's bottom with container's bottom
  const targetBottom = targetRect.top + targetRect.height
  const containerBottom = containerRect.top + container.clientHeight
  return targetBottom - containerBottom + container.scrollTop
}

/**
 * Smooth-scroll a container so that target element's edge aligns with viewport edge.
 *
 * @param {HTMLElement} container - Scrollable element.
 * @param {HTMLElement} target - Element to align.
 * @param {'top' | 'bottom'} edge - Which edge to align.
 * @param {number} duration - Animation duration in ms.
 */
export function scrollToEdge(container, target, edge, duration) {
  const destination = computeScrollDestination(container, target, edge)
  const start = container.scrollTop
  const distance = destination - start
  const startTime = performance.now()

  function step(now) {
    const elapsed = now - startTime
    const progress = Math.min(elapsed / duration, 1)
    container.scrollTop = start + distance * easeOutCubic(progress)
    if (progress < 1) {
      requestAnimationFrame(step)
    }
  }

  requestAnimationFrame(step)
}

/** Calculate ease-out cubic easing value for t in [0,1]. */
export function easeOutCubic(t) {
  return 1 - (1 - t) ** 3
}

/**
 * Smooth-scroll a container to align an element, then briefly add a highlight
 * class that's removed after a timeout.
 *
 * Default class `jump-highlight` and 1500ms timeout match the three call sites
 * (BookmarksPanel, TasksPanel, ChatPanel). useMessageJump uses its own
 * highlight helper to coordinate cancellation across consecutive jumps —
 * that hook is intentionally not collapsed here.
 *
 * @param {HTMLElement} scrollContainer
 * @param {HTMLElement} target
 * @param {{
 *   duration?: number,
 *   highlightMs?: number,
 *   highlightClass?: string,
 *   edge?: 'top' | 'bottom',
 * }} [options]
 */
export function scrollAndHighlight(
  scrollContainer,
  target,
  { duration = 150, highlightMs = 1500, highlightClass = 'jump-highlight', edge = 'top' } = {},
) {
  scrollToEdge(scrollContainer, target, edge, duration)
  target.classList.add(highlightClass)
  setTimeout(() => target.classList.remove(highlightClass), highlightMs)
}
