/** Scroll-axis positions of every turn a jump can land on. */

import { computeScrollDestination } from '../../../utils/scroll'

/**
 * Every turn a jump can land on, in scroll-axis order.
 *
 * Historical turns come from the virtualizer's measurements, so they're addressable whether or not mounted.
 * The active turn is not part of the windowed list - ChatPanel renders it directly beneath - so
 * it is measured from its own element, which is always present.
 *
 * @param {HTMLElement} container - The chat scroll container.
 * @param {object} [virtualizerRef] - Ref holding the turn virtualizer.
 * @returns {Array<{start: number, index?: number, el?: HTMLElement}>} Targets in scroll-axis order.
 */
export function jumpTargets(container, virtualizerRef) {
  const cache = virtualizerRef?.current?.measurementsCache
  const targets = []

  // Read by index on purpose. The cache is a lazily-materialized proxy over a sparse array: it has
  // only a `get` trap, so reading an index builds that entry, but existence-probing methods
  // (filter, map, forEach) hit the sparse target, find a hole, and skip the entry without reading it.
  // Those methods therefore see only entries an earlier render already materialized - roughly the mounted window,
  // precisely the turns a jump doesn't need help reaching.
  for (let i = 0; i < (cache?.length ?? 0); i++) {
    const measurement = cache[i]
    // An unpriced turn carries no offset; skipping it keeps a null from coercing to 0 and hijacking upward jumps.
    if (typeof measurement?.start === 'number') {
      targets.push({ start: measurement.start, index: measurement.index })
    }
  }

  const activeEl = container.querySelector(':scope > [data-testid="turn-container"]')
  if (activeEl) {
    targets.push({ start: computeScrollDestination(container, activeEl, 'top'), el: activeEl })
  }

  return targets
}
