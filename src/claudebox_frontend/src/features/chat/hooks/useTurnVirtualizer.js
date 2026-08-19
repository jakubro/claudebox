/** Windowed turn list - mounts viewport+overscan turns and prices the rest by prediction. */

import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { TURN_HORIZONTAL_PADDING_PX, TURN_OVERSCAN } from '../../../config/dimensions'
import { predictTurnHeight } from '../utils/predictTurnHeight'
import {
  measureRoundedElement,
  useMirroredScrollElement,
  useScrollMargin,
} from './useVirtualListGeometry'

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
 */
export default function useTurnVirtualizer({
  messagesRef,
  listRef,
  turns,
  collapsedTurnIds = EMPTY_SET,
  splitEnabled = false,
}) {
  const scrollEl = useMirroredScrollElement(messagesRef)

  // The scroll element does not exist during the first render, so the virtualizer has no viewport to compute a
  // range from and would fall back to rendering every turn. Hand it the window height instead: one frame of a
  // roughly-sized window costs a handful of turns, where the fallback costs the whole transcript - the exact cost
  // windowing exists to remove.
  const initialRect = useMemo(
    () => ({ width: 0, height: typeof window === 'undefined' ? 0 : window.innerHeight }),
    [],
  )

  // Jump targeting compares measurements against real `scrollTop` values - and against the active turn, which is
  // measured from its own element - so the two coordinate spaces need the same margin baked in.
  const scrollMargin = useScrollMargin(scrollEl, listRef)

  const estimateSize = useCallback(
    index => {
      const turn = turns[index]
      const width = Math.max(0, (scrollEl?.clientWidth || 0) - TURN_HORIZONTAL_PADDING_PX)
      return predictTurnHeight(turn, width, collapsedTurnIds.has(turn?.turn_id), splitEnabled)
    },
    [turns, collapsedTurnIds, scrollEl, splitEnabled],
  )

  const getItemKey = useCallback(index => turns[index]?.turn_id ?? index, [turns])

  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => scrollEl,
    estimateSize,
    getItemKey,
    initialRect,
    scrollMargin,
    overscan: TURN_OVERSCAN,
    measureElement: measureRoundedElement,
  })

  // A split flip leaves cached heights stale; re-measure on its edge only, never every render.
  const prevSplitEnabledRef = useRef(splitEnabled)
  useEffect(() => {
    if (prevSplitEnabledRef.current !== splitEnabled) {
      virtualizer.measure()
    }
    prevSplitEnabledRef.current = splitEnabled
  }, [splitEnabled, virtualizer])

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
