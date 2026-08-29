/** Scroll-geometry plumbing shared by every windowed list built on @tanstack/react-virtual. */

import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useLayoutEffect, useMemo, useState } from 'react'

/**
 * Attach a scroll container to state exactly once per attach/detach, so a virtualizer sees it as
 * soon as it mounts. `attachRef`'s identity must stay stable, or React re-attaches every render.
 */
export function useScrollElementRef(externalRef) {
  const [scrollEl, setScrollEl] = useState(null)
  const attachRef = useCallback(
    node => {
      if (externalRef) {
        externalRef.current = node
      }
      setScrollEl(node)
    },
    [externalRef],
  )

  return [scrollEl, attachRef]
}

/**
 * Distance from the top of the scroll content to the top of the windowed list, measured rather
 * than assumed. Without it every measured row start is short by the container's own padding, and
 * anything comparing a measurement against a real `scrollTop` drifts by exactly that amount.
 */
export function useScrollMargin(scrollEl, listRef) {
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

  return scrollMargin
}

/**
 * A virtualizer `measureElement` that rounds the read and refuses a zero.
 *
 * Unrounded, a row landing between two subpixels reports a new height on every pass, and each
 * report re-renders and re-measures. A row that has not painted measures 0, and recording that
 * shrinks the total, widens the range and mounts more unpainted rows until the whole list is
 * mounted - the failure windowing exists to prevent. Keeping the estimate costs one stale row.
 */
export function measureRoundedElement(el, _entry, instance) {
  const measured = Math.round(el.getBoundingClientRect().height)

  return measured > 0 ? measured : instance.options.estimateSize(Number(el.dataset.index))
}

/**
 * The initial-rect/scroll-margin preamble every windowed list hook needs before building its own
 * `estimateSize`, which still wants `scrollEl` - so this returns it rather than swallowing it.
 */
export function useVirtualizerGeometry(scrollEl, listRef) {
  // The scroll element does not exist on the first render, so the virtualizer would fall back to
  // rendering every item. Hand it the window height: a roughly-sized frame beats the whole list.
  const initialRect = useMemo(
    () => ({ width: 0, height: typeof window === 'undefined' ? 0 : window.innerHeight }),
    [],
  )

  const scrollMargin = useScrollMargin(scrollEl, listRef)

  return { scrollEl, initialRect, scrollMargin }
}

/**
 * The common `useVirtualizer(...)` call shape every windowed list hook builds, plus whatever extra
 * options one particular list needs (e.g. the terminal's anchor-to-end autoscroll).
 */
export function useWindowedVirtualizer({
  count,
  scrollEl,
  estimateSize,
  getItemKey,
  initialRect,
  scrollMargin,
  overscan,
  extraOptions,
}) {
  return useVirtualizer({
    count,
    getScrollElement: () => scrollEl,
    estimateSize,
    getItemKey,
    initialRect,
    scrollMargin,
    overscan,
    measureElement: measureRoundedElement,
    ...extraOptions,
  })
}

/**
 * `useWindowedVirtualizer` keyed by `turn_id`, falling back to the array index for a turn with no
 * id yet - the same `turn_id ?? index` key the transcript uses.
 */
export function useTurnKeyedVirtualizer({
  turns,
  scrollEl,
  estimateSize,
  initialRect,
  scrollMargin,
  overscan,
  extraOptions,
}) {
  const getItemKey = useCallback(index => turns[index]?.turn_id ?? index, [turns])

  return useWindowedVirtualizer({
    count: turns.length,
    scrollEl,
    estimateSize,
    getItemKey,
    initialRect,
    scrollMargin,
    overscan,
    extraOptions,
  })
}
