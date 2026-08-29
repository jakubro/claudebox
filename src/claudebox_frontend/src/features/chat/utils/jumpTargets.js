/** Scroll-axis positions of every turn a jump can land on. */

import { computeScrollDestination } from '../../../utils/scroll'

/**
 * Every entry a jump can land on, in scroll-axis order. Column-agnostic - used by both the chat
 * transcript and the terminal column.
 *
 * Windowed entries come from the virtualizer's measurements, so they are addressable unmounted.
 * The trailing entry sits outside that list, so the caller - which knows where - supplies it.
 *
 * @param {HTMLElement} container - The scroll container.
 * @param {object} [virtualizerRef] - Ref holding the column's virtualizer.
 * @param {HTMLElement} [trailingEl] - The trailing entry's element, if the column has entries.
 * @returns {Array<{start: number, index?: number, el?: HTMLElement}>} Targets in scroll-axis order.
 */
export function jumpTargets(container, virtualizerRef, trailingEl) {
  const cache = virtualizerRef?.current?.measurementsCache
  const targets = []

  // Every target is clamped to the container's max scrollTop, since an estimated `start` can
  // overshoot - unclamped, it compares as "still ahead" and the end-of-list fallback never fires.
  const maxStart =
    Number.isFinite(container.scrollHeight) && Number.isFinite(container.clientHeight)
      ? Math.max(0, container.scrollHeight - container.clientHeight)
      : Number.POSITIVE_INFINITY

  // Read by index on purpose. The cache is a lazily-materialized proxy over a sparse array: it has
  // only a `get` trap, so reading an index builds that entry, but existence-probing methods
  // (filter, map, forEach) hit the sparse target, find a hole, and skip the entry without reading it.
  // Those methods therefore see only entries an earlier render already materialized - roughly the mounted window,
  // precisely the entries a jump doesn't need help reaching.
  for (let i = 0; i < (cache?.length ?? 0); i++) {
    const measurement = cache[i]
    // An unpriced entry carries no offset; skipping it keeps a null from coercing to 0 and
    // hijacking upward jumps.
    if (typeof measurement?.start === 'number') {
      targets.push({ start: Math.min(measurement.start, maxStart), index: measurement.index })
    }
  }

  if (trailingEl) {
    const start = Math.min(computeScrollDestination(container, trailingEl, 'top'), maxStart)
    targets.push({ start, el: trailingEl })
  }

  return targets
}
