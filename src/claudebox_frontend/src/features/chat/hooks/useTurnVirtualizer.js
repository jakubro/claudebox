/** Windowed turn list - mounts viewport+overscan turns and prices the rest by prediction. */

import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { TURN_HORIZONTAL_PADDING_PX, TURN_OVERSCAN } from '../../../config/dimensions'
import { predictTurnHeight } from '../utils/predictTurnHeight'

const EMPTY_SET = new Set()

/**
 * Window the historical turn list against the chat scroll container.
 *
 * Only turns intersecting the viewport (plus `TURN_OVERSCAN` either side) are mounted, so opening a session
 * stops costing in proportion to its length. The scroll axis is held steady by `estimateSize`, which prices
 * an unmounted turn with the same content-derived predictor the minimap uses - already calibrated against
 * measured fixtures - while the virtualizer's measurement cache replaces that estimate with the real height
 * the first time a turn mounts.
 *
 * Keyed by `turn_id` rather than index, so a measurement survives the list shifting underneath it (a compaction
 * dropping an earlier turn, or a rewind).
 *
 * Returns `windowed: false` where no window could be computed at all - callers render every turn in that case,
 * because an unwindowed chat is slow while an empty one is broken. That covers environments without layout; the
 * frames before the container attaches are covered by `initialRect` instead.
 *
 * @param {object} params
 * @param {object} params.messagesRef - Ref to the chat scroll container.
 * @param {object} params.listRef - Ref to the list element inside that container.
 * @param {Array} params.turns - Historical turns (active turn excluded).
 * @param {Set} [params.collapsedTurnIds] - Turn ids currently collapsed.
 * @returns {{virtualizer: object, virtualItems: Array, scrollMargin: number, windowed: boolean}}
 */
export default function useTurnVirtualizer({
  messagesRef,
  listRef,
  turns,
  collapsedTurnIds = EMPTY_SET,
}) {
  // Mirror the scroll element into state so the virtualizer re-evaluates once the ref attaches - it is still null
  // on first render. Reading it from a layout effect rather than during render is what guarantees convergence: a
  // ref assignment does not schedule anything, so a render-phase mirror only catches up if some unrelated update
  // happens to re-render this list. After a remount against a session that has stopped streaming there may be no
  // such update, and the list would stay unwindowed indefinitely. The effect runs on every commit, so the element
  // is picked up on the one right after mount, and before paint.
  const [scrollEl, setScrollEl] = useState(null)
  useLayoutEffect(() => {
    const el = messagesRef?.current ?? null
    // Returning the previous value tells React there is nothing to re-render - without it this effect would cost
    // an extra render pass on every commit.
    setScrollEl(prev => (prev === el ? prev : el))
  })

  // The scroll element does not exist during the first render, so the virtualizer has no viewport to compute a
  // range from and would fall back to rendering every turn. Hand it the window height instead: one frame of a
  // roughly-sized window costs a handful of turns, where the fallback costs the whole transcript - the exact cost
  // windowing exists to remove.
  const initialRect = useMemo(
    () => ({ width: 0, height: typeof window === 'undefined' ? 0 : window.innerHeight }),
    [],
  )

  // Distance from the top of the scroll content to the top of the list. Without it every measurement is short by
  // the container's padding, and since jump targeting compares those measurements against real `scrollTop` values
  // - and against the active turn, which is measured from its own element - the two coordinate spaces drift apart
  // by exactly that padding.
  const [scrollMargin, setScrollMargin] = useState(0)
  useLayoutEffect(() => {
    const listEl = listRef?.current
    if (!(scrollEl && listEl)) {
      return
    }

    const offset = Math.round(
      listEl.getBoundingClientRect().top -
        scrollEl.getBoundingClientRect().top +
        scrollEl.scrollTop,
    )
    setScrollMargin(prev => (prev === offset ? prev : offset))
  }, [scrollEl, listRef])

  const estimateSize = useCallback(
    index => {
      const turn = turns[index]
      const width = Math.max(0, (scrollEl?.clientWidth || 0) - TURN_HORIZONTAL_PADDING_PX)
      return predictTurnHeight(turn, width, collapsedTurnIds.has(turn?.turn_id))
    },
    [turns, collapsedTurnIds, scrollEl],
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
    // Rounded on purpose. The default reads a fractional border-box height, and
    // a row whose height lands between two subpixels reports a different value
    // on each pass - every report re-renders the list, which re-measures, which
    // reports again. Rounding makes a settled row measure identically forever.
    //
    // A zero is refused for a related reason: a row that has not painted yet
    // measures 0, and recording that shrinks the total, which widens the range,
    // which mounts more rows, which measure 0 in turn. Left alone the window
    // grows until the whole transcript is mounted - the failure this hook
    // exists to prevent. Keeping the estimate costs one stale row instead.
    measureElement: (el, _entry, instance) => {
      const measured = Math.round(el.getBoundingClientRect().height)

      return measured > 0 ? measured : instance.options.estimateSize(Number(el.dataset.index))
    },
  })

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
