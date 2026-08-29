/** Step prev/next between entries in a windowed scroll column. */

import { useCallback, useRef } from 'react'
import { MESSAGE_JUMP_HIGHLIGHT_MS } from '../../../config/timing'
import { findTurnRow, MOUNT_FRAMES, pollFrames } from '../../../utils/mountTurn'
import { jumpTargets } from '../utils/jumpTargets'

const HIGHLIGHT_CLASS = 'jump-highlight'

/** Ignore sub-pixel and near-edge offsets when deciding what is above/below. */
const EDGE_EPSILON_PX = 10

/**
 * Step prev/next between a windowed column's entries, landing each at the top with a brief
 * highlight. Targets come from the virtualizer's measurements, which cover unmounted entries too.
 *
 * @param {object} containerRef - Ref to the column's scroll container.
 * @param {object} [virtualizerRef] - Ref holding the column's virtualizer.
 * @param {function} [markProgrammaticScroll] - Brackets scroll writes against the intent latch.
 * @param {function} [markUserIntent] - Fired before an off-bottom step.
 * @param {function} [markReturnedToBottom] - Fired before an at-bottom step.
 * @param {string} rowSelector - The windowed row's own class, passed to `findTurnRow`.
 * @param {function} [resolveHighlightTarget] - Given the landed element, returns what to flash.
 * @param {function} resolveTrailingEl - Given the container, returns the trailing entry's element.
 * @param {Element} [root] - Scopes `findTurnRow` to one rail group.
 * @param {function} [isTargetable] - Whether a step may land on a windowed index; the trailing
 *   element carries no index and is never filtered.
 */
export default function useColumnStep({
  containerRef,
  virtualizerRef,
  markProgrammaticScroll,
  markUserIntent,
  markReturnedToBottom,
  rowSelector,
  resolveHighlightTarget,
  resolveTrailingEl,
  root,
  isTargetable,
}) {
  const highlightTimeoutRef = useRef(null)

  const highlightElement = useCallback(el => {
    if (highlightTimeoutRef.current) {
      const prev = highlightTimeoutRef.current
      prev.el.classList.remove(HIGHLIGHT_CLASS)
      clearTimeout(prev.timer)
    }

    el.classList.add(HIGHLIGHT_CLASS)
    const timer = setTimeout(() => {
      el.classList.remove(HIGHLIGHT_CLASS)
      highlightTimeoutRef.current = null
    }, MESSAGE_JUMP_HIGHLIGHT_MS)
    highlightTimeoutRef.current = { el, timer }
  }, [])

  /** Highlight the landed entry, falling back to the element itself. */
  const highlightLanded = useCallback(
    el => {
      const target = (resolveHighlightTarget ? resolveHighlightTarget(el) : el) || el
      if (target) {
        highlightElement(target)
      }
    },
    [highlightElement, resolveHighlightTarget],
  )

  /** Scroll an entry index to the top of the viewport and highlight it once mounted. */
  const goToIndex = useCallback(
    index => {
      const virtualizer = virtualizerRef?.current
      markUserIntent?.()
      markProgrammaticScroll?.()
      virtualizer.scrollToIndex(index, { align: 'start' })
      // The entry may be windowed out and only mount on a later frame, so highlighting on the next
      // frame alone would usually find nothing.
      pollFrames(MOUNT_FRAMES, () => findTurnRow(index, rowSelector, root), highlightLanded)
    },
    [virtualizerRef, rowSelector, root, markProgrammaticScroll, markUserIntent, highlightLanded],
  )

  /** Land on an already-mounted entry (the trailing one) and highlight it. */
  const goToElement = useCallback(
    (container, target, engage) => {
      engage()
      markProgrammaticScroll?.()
      container.scrollTop = target.start
      highlightLanded(target.el)
    },
    [markProgrammaticScroll, highlightLanded],
  )

  // A target carrying no `index` (the trailing element) is never filtered - only windowed targets
  // are subject to `isTargetable`.
  const targetableOnly = useCallback(
    targets =>
      isTargetable ? targets.filter(t => t.index === undefined || isTargetable(t.index)) : targets,
    [isTargetable],
  )

  const stepPrev = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const cutoff = container.scrollTop - EDGE_EPSILON_PX
    const trailingEl = resolveTrailingEl(container)
    const target = [...targetableOnly(jumpTargets(container, virtualizerRef, trailingEl))]
      .reverse()
      .find(t => t.start < cutoff)
    if (target?.el) {
      goToElement(container, target, () => markUserIntent?.())
      return
    }
    if (target) {
      goToIndex(target.index)
      return
    }

    // Nothing above the viewport - settle at the very top.
    markUserIntent?.()
    markProgrammaticScroll?.()
    container.scrollTop = 0
  }, [
    containerRef,
    virtualizerRef,
    resolveTrailingEl,
    targetableOnly,
    goToIndex,
    goToElement,
    markProgrammaticScroll,
    markUserIntent,
  ])

  const stepNext = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const cutoff = container.scrollTop + EDGE_EPSILON_PX
    const trailingEl = resolveTrailingEl(container)
    const target = targetableOnly(jumpTargets(container, virtualizerRef, trailingEl)).find(
      t => t.start > cutoff,
    )
    if (target?.el) {
      goToElement(container, target, () => markUserIntent?.())
      return
    }
    if (target) {
      goToIndex(target.index)
      return
    }

    // Past the last windowed entry - the trailing one lives at the bottom, so landing there
    // re-engages autoscroll.
    markReturnedToBottom?.()
    markProgrammaticScroll?.()
    container.scrollTop = container.scrollHeight
  }, [
    containerRef,
    virtualizerRef,
    resolveTrailingEl,
    targetableOnly,
    goToIndex,
    goToElement,
    markProgrammaticScroll,
    markUserIntent,
    markReturnedToBottom,
  ])

  return { stepPrev, stepNext }
}
