/** A right-slot column's overview data: bars, autoscroll getter, height, landing transition. */

import { useCallback, useMemo, useRef } from 'react'

/**
 * Extracted to keep ChatPanel below the cognitive-complexity gate. What a "bar" prices is the
 * caller's to define; this hook owns only the cache, the getters, and the landing transition.
 *
 * @param {Array} items - The column's own entries.
 * @param {function} buildBars - `(items, metricsCacheRef) => bars[]`, referentially stable: it is
 *   a `useMemo` dependency, so a fresh closure would rebuild the bars every render.
 * @param {object} autoScrollEnabledRef - The column's own scroll owner ref (`useColumnScroll`).
 * @param {function} markUserIntent - Disengages the column's own following state.
 * @param {function} markReturnedToBottom - Re-engages it.
 */
export function useColumnMinimapData({
  items,
  buildBars,
  autoScrollEnabledRef,
  markUserIntent,
  markReturnedToBottom,
}) {
  // Shared with the column's own virtualizer so an entry's content is extracted once, whichever
  // side - the window or the overview - asks for it first.
  const metricsCacheRef = useRef(new Map())
  const bars = useMemo(() => buildBars(items, metricsCacheRef), [items, buildBars])
  const getAutoScrollEnabled = useCallback(
    () => autoScrollEnabledRef.current,
    [autoScrollEnabledRef],
  )
  const getLogicalScrollHeight = useCallback(
    () => bars.reduce((sum, bar) => sum + bar.height, 0),
    [bars],
  )
  // A click or drag picks its transition the way a step does - off-bottom raises intent,
  // at-bottom marks a return - so the overview moves the column through its scroll owner.
  const handleMinimapLanding = useCallback(
    atBottom => {
      if (atBottom) {
        markReturnedToBottom()
      } else {
        markUserIntent()
      }
    },
    [markReturnedToBottom, markUserIntent],
  )

  return {
    metricsCacheRef,
    bars,
    getAutoScrollEnabled,
    getLogicalScrollHeight,
    handleMinimapLanding,
  }
}
