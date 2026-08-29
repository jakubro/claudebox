/** Windowed work panel - mounts viewport and overscan entries, prices the rest by prediction. */

import { useCallback, useEffect, useRef } from 'react'
import { WORK_ENTRY_HORIZONTAL_PADDING_PX, WORK_OVERSCAN } from '../../../config/dimensions'
import { predictWorkEntryHeight } from '../utils/predictWorkEntryHeight'
import useElementWidth from './useElementWidth'
import { useTurnKeyedVirtualizer, useVirtualizerGeometry } from './useVirtualListGeometry'

/**
 * Window the work panel's turn entries against its own scroll container. `turns` is unfiltered -
 * a turn with nothing routed away prices at zero height, so no membership pass is needed first.
 *
 * @param {object} [metricsCacheRef] - Shared per-turn height cache, falling back to a local one;
 *   `WorkColumn` passes the ref its overview bars use so content is priced once.
 */
export default function useWorkPanelVirtualizer({
  containerEl,
  containerRef,
  listRef,
  turns,
  mode,
  metricsCacheRef: externalMetricsCacheRef,
}) {
  const { scrollEl, initialRect, scrollMargin } = useVirtualizerGeometry(containerEl, listRef)
  const width = useElementWidth(containerRef)
  const ownMetricsCacheRef = useRef(new Map())
  const metricsCacheRef = externalMetricsCacheRef || ownMetricsCacheRef

  const estimateSize = useCallback(
    index => {
      const turn = turns[index]
      const effectiveWidth = Math.max(
        0,
        (scrollEl?.clientWidth || 0) - WORK_ENTRY_HORIZONTAL_PADDING_PX,
      )
      // The trailing turn's content grows on every landed call - never cache it, or the estimate
      // (and the overview bar priced from it) would go stale the moment the next call lands.
      const cacheRef = index === turns.length - 1 ? null : metricsCacheRef
      return predictWorkEntryHeight(turn, effectiveWidth, mode, cacheRef)
    },
    [turns, scrollEl, mode, metricsCacheRef],
  )

  const virtualizer = useTurnKeyedVirtualizer({
    turns,
    scrollEl,
    estimateSize,
    initialRect,
    scrollMargin,
    overscan: WORK_OVERSCAN,
  })

  // A width change (divider drag) leaves cached heights stale - tool blocks wrap, so every one of
  // them may be wrong. Re-measure and drop the cache on the value's own edge, not every render.
  const prevWidthRef = useRef(width)
  useEffect(() => {
    if (prevWidthRef.current !== width) {
      metricsCacheRef.current.clear()
      virtualizer.measure()
    }
    prevWidthRef.current = width
  }, [width, virtualizer, metricsCacheRef])

  const virtualItems = virtualizer.getVirtualItems()

  return {
    virtualizer,
    virtualItems,
    scrollMargin,
    windowed: turns.length === 0 || virtualItems.length > 0,
  }
}
