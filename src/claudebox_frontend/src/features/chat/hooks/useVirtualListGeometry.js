/** Scroll-geometry plumbing shared by every windowed list built on @tanstack/react-virtual. */

import { useLayoutEffect, useState } from 'react'

/**
 * Mirror a scroll container ref into state so a virtualizer re-evaluates once it attaches - the
 * ref is null on first render and a ref assignment schedules no update. Read from a layout effect
 * on every commit, not during render: a render-phase read only catches up if some unrelated update
 * re-renders the list, and after a remount there may be none.
 */
export function useMirroredScrollElement(ref) {
  const [scrollEl, setScrollEl] = useState(null)
  useLayoutEffect(() => {
    const el = ref?.current ?? null
    setScrollEl(prev => (prev === el ? prev : el))
  })

  return scrollEl
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
