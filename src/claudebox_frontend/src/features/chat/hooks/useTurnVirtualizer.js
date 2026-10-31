/** Windowed turn list - mounts viewport+overscan turns and prices the rest by prediction. */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import {
  THREAD_FOLD_ROW_HEIGHT_PX,
  TURN_HORIZONTAL_PADDING_PX,
  TURN_OVERSCAN,
} from '../../../config/dimensions'
import {
  measureRoundedElement,
  useTurnKeyedVirtualizer,
  useVirtualizerGeometry,
} from '../../../hooks/useVirtualListGeometry'
import { sameIdSet } from '../../../utils/comparators'
import { NO_TOOL_MARKED, TurnRoutingMode } from '../../../utils/eventProcessing'
import { predictTurnHeight } from '../utils/predictTurnHeight'

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
 *
 * `rowSizes` (a `createRowSizeStore`) receives every turn's size as the list learns it: measured
 * on mount and on a collapse flip, or for an unmounted turn the size last measured in its new state.
 */
export default function useTurnVirtualizer({
  messagesEl,
  listRef,
  turns,
  collapsedTurnIds = EMPTY_SET,
  mode = TurnRoutingMode.OFF,
  foldBoundary = -1,
  foldExpanded = false,
  rowSizes = null,
  bookmarkedPartsOf = null,
  isMarked = NO_TOOL_MARKED,
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
      return predictTurnHeight(
        turn,
        width,
        collapsedTurnIds.has(turn?.turn_id),
        mode,
        bookmarkedPartsOf?.(turn?.turn_id),
        isMarked,
      )
    },
    [turns, collapsedTurnIds, scrollEl, mode, folded, foldBoundary, bookmarkedPartsOf, isMarked],
  )

  const collapsedRef = useRef(collapsedTurnIds)
  collapsedRef.current = collapsedTurnIds
  const foldRef = useRef({ folded, foldBoundary })
  foldRef.current = { folded, foldBoundary }
  // Keyed `${turnId}:${collapsed}`: an unmounted turn that flips takes its last real size in the
  // new state, so it does not fall back to the estimate it was already measured past.
  const sizeByStateRef = useRef(new Map())

  const measureElement = useCallback(
    (el, entry, instance) => {
      const size = measureRoundedElement(el, entry, instance)
      const index = Number(el.dataset.index)
      const turnId = turns[index]?.turn_id
      const fold = foldRef.current
      // An unpainted row comes back as its estimate, which is not a size worth remembering.
      const painted = el.getBoundingClientRect().height > 0
      if (turnId && painted && !(fold.folded && index <= fold.foldBoundary)) {
        sizeByStateRef.current.set(`${turnId}:${collapsedRef.current.has(turnId)}`, size)
        rowSizes?.set(turnId, size)
      }
      return size
    },
    [turns, rowSizes],
  )

  const virtualizer = useTurnKeyedVirtualizer({
    turns,
    scrollEl,
    estimateSize,
    initialRect,
    scrollMargin,
    overscan: TURN_OVERSCAN,
    extraOptions: { measureElement },
  })

  // Re-measuring drops every cached size, so the per-state memory and the published sizes go too.
  const remeasure = useCallback(() => {
    sizeByStateRef.current.clear()
    for (const turn of turns) {
      rowSizes?.delete(turn?.turn_id)
    }
    virtualizer.measure()
  }, [virtualizer, rowSizes, turns])

  // A mode transition leaves cached heights stale; re-measure on its edge only. Keyed on the mode
  // value, so any transition between two modes fires it, not just an on/off edge.
  const prevModeRef = useRef(mode)
  useEffect(() => {
    if (prevModeRef.current !== mode) {
      remeasure()
    }
    prevModeRef.current = mode
  }, [mode, remeasure])

  const prevMarkedRef = useRef(isMarked)
  useEffect(() => {
    if (prevMarkedRef.current !== isMarked && mode === TurnRoutingMode.FOCUSED) {
      remeasure()
    }
    prevMarkedRef.current = isMarked
  }, [isMarked, mode, remeasure])

  // The fold toggle changes heights of rows that are mostly unmounted (nothing to fire a
  // ResizeObserver), so it needs the same explicit re-measure the mode transition above gets.
  const prevFoldedRef = useRef(folded)
  useEffect(() => {
    if (prevFoldedRef.current !== folded) {
      remeasure()
    }
    prevFoldedRef.current = folded
  }, [folded, remeasure])

  // The live turn joins this list already measured (published by its own observer); carry that
  // size over, or an unmounted arrival falls back to the estimate it was already measured past.
  const prevTurnIdsRef = useRef(null)
  useLayoutEffect(() => {
    const prevIds = prevTurnIdsRef.current
    prevTurnIdsRef.current = new Set(turns.map(turn => turn?.turn_id))
    if (!(prevIds && rowSizes)) {
      return
    }
    turns.forEach((turn, index) => {
      const turnId = turn?.turn_id
      const size = turnId && !prevIds.has(turnId) ? rowSizes.get(turnId) : undefined
      if (size === undefined || virtualizer.elementsCache.get(turnId)?.isConnected) {
        return
      }
      sizeByStateRef.current.set(`${turnId}:${collapsedRef.current.has(turnId)}`, size)
      virtualizer.resizeItem(index, size)
    })
  }, [turns, virtualizer, rowSizes])

  // Under Focused a bookmark shows its call, so a turn whose set changed while unmounted is priced
  // again from its estimate; a mounted one reports its new size through its own observer.
  const prevPartsOfRef = useRef(bookmarkedPartsOf)
  useLayoutEffect(() => {
    const prevPartsOf = prevPartsOfRef.current
    prevPartsOfRef.current = bookmarkedPartsOf
    if (prevPartsOf === bookmarkedPartsOf || mode !== TurnRoutingMode.FOCUSED) {
      return
    }
    turns.forEach((turn, index) => {
      const turnId = turn?.turn_id
      const changed = !sameIdSet(prevPartsOf?.(turnId), bookmarkedPartsOf?.(turnId))
      if (!changed || virtualizer.elementsCache.get(turnId)?.isConnected) {
        return
      }
      sizeByStateRef.current.delete(`${turnId}:${collapsedRef.current.has(turnId)}`)
      rowSizes?.delete(turnId)
      virtualizer.resizeItem(index, estimateSize(index))
    })
  }, [bookmarkedPartsOf, mode, turns, virtualizer, estimateSize, rowSizes])

  // A collapse flip is priced here rather than left to ResizeObserver: an unmounted turn fires none,
  // and a mounted one that the window drops before its observer reports never records the new size.
  const prevCollapsedRef = useRef(collapsedTurnIds)
  useLayoutEffect(() => {
    const prev = prevCollapsedRef.current
    prevCollapsedRef.current = collapsedTurnIds
    if (prev === collapsedTurnIds) {
      return
    }
    turns.forEach((turn, index) => {
      const turnId = turn?.turn_id
      const collapsed = collapsedTurnIds.has(turnId)
      if (!turnId || prev.has(turnId) === collapsed) {
        return
      }
      const el = virtualizer.elementsCache.get(turnId)
      if (el?.isConnected) {
        virtualizer.resizeItem(index, measureElement(el, undefined, virtualizer))
        return
      }
      const size = sizeByStateRef.current.get(`${turnId}:${collapsed}`) ?? estimateSize(index)
      virtualizer.resizeItem(index, size)
      rowSizes?.set(turnId, size)
    })
  }, [collapsedTurnIds, turns, virtualizer, estimateSize, rowSizes, measureElement])

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
