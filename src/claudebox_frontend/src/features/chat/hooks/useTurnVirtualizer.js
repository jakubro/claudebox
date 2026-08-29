/** Windowed turn list - mounts viewport+overscan turns and prices the rest by prediction. */

import { useCallback, useEffect, useRef } from 'react'
import {
  THREAD_FOLD_ROW_HEIGHT_PX,
  TURN_HORIZONTAL_PADDING_PX,
  TURN_OVERSCAN,
} from '../../../config/dimensions'
import { TurnRoutingMode } from '../../../utils/eventProcessing'
import { predictTurnHeight } from '../utils/predictTurnHeight'
import { useTurnKeyedVirtualizer, useVirtualizerGeometry } from './useVirtualListGeometry'

const EMPTY_SET = new Set()

/**
 * Window the historical turn list (active turn excluded) against the chat scroll container.
 *
 * Only turns within the viewport plus `TURN_OVERSCAN` mount, so opening a session stops costing in
 * proportion to its length. `estimateSize` holds the scroll axis steady by pricing unmounted turns
 * with the same fixture-calibrated predictor the minimap uses; the cache swaps in real heights on
 * first mount. Keyed by `turn_id`, not index, so measurements survive a compaction or rewind.
 *
 * `windowed: false` means no window could be computed and the caller must render every turn - an
 * unwindowed chat is slow, an empty one is broken. Covers layout-less environments; frames before
 * the container attaches are covered by `initialRect`.
 *
 * `foldBoundary` and `foldExpanded` override pricing while folded: index 0 prices as the fold row,
 * `1..foldBoundary` as zero, the rest normally - leaving the turn-index space itself unchanged.
 */
export default function useTurnVirtualizer({
  messagesEl,
  listRef,
  turns,
  collapsedTurnIds = EMPTY_SET,
  mode = TurnRoutingMode.OFF,
  foldBoundary = -1,
  foldExpanded = false,
}) {
  // Jump targeting compares measurements against real `scrollTop` values - and against the active turn, which is
  // measured from its own element - so the two coordinate spaces need the same margin baked in.
  const { scrollEl, initialRect, scrollMargin } = useVirtualizerGeometry(messagesEl, listRef)

  const folded = foldBoundary >= 0 && !foldExpanded

  const estimateSize = useCallback(
    index => {
      if (folded) {
        if (index === 0) {
          return THREAD_FOLD_ROW_HEIGHT_PX
        }
        if (index <= foldBoundary) {
          return 0
        }
      }
      const turn = turns[index]
      const width = Math.max(0, (scrollEl?.clientWidth || 0) - TURN_HORIZONTAL_PADDING_PX)
      return predictTurnHeight(turn, width, collapsedTurnIds.has(turn?.turn_id), mode)
    },
    [turns, collapsedTurnIds, scrollEl, mode, folded, foldBoundary],
  )

  const virtualizer = useTurnKeyedVirtualizer({
    turns,
    scrollEl,
    estimateSize,
    initialRect,
    scrollMargin,
    overscan: TURN_OVERSCAN,
  })

  // A mode transition leaves cached heights stale; re-measure on its edge only. Keyed on the mode
  // value, so any transition between two modes fires it, not just an on/off edge.
  const prevModeRef = useRef(mode)
  useEffect(() => {
    if (prevModeRef.current !== mode) {
      virtualizer.measure()
    }
    prevModeRef.current = mode
  }, [mode, virtualizer])

  // The fold toggle changes heights of rows that are mostly unmounted (nothing to fire a
  // ResizeObserver), so it needs the same explicit re-measure the mode transition above gets.
  const prevFoldedRef = useRef(folded)
  useEffect(() => {
    if (prevFoldedRef.current !== folded) {
      virtualizer.measure()
    }
    prevFoldedRef.current = folded
  }, [folded, virtualizer])

  // Windowing is decided by what the virtualizer actually produced, not by a separate reading of the container.
  // Asking the element for its height and letting the virtualizer size itself from its own rect gives two
  // answers that can disagree, and the disagreement resolves as a chat with a scroll extent and nothing in it.
  // An empty window where turns exist means no window could be computed, whatever the reason - so the caller
  // renders all of them.
  const virtualItems = virtualizer.getVirtualItems()

  return {
    virtualizer,
    virtualItems,
    // Measured starts are in scroll-container space; rows are positioned inside
    // the list, so each one gives back what the margin added.
    scrollMargin,
    windowed: turns.length === 0 || virtualItems.length > 0,
  }
}
