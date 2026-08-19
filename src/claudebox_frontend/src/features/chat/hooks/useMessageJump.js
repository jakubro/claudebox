/** Jump navigation between human messages in the chat scroll container. */

import { useCallback, useRef } from 'react'
import { MESSAGE_JUMP_HIGHLIGHT_MS } from '../../../config/timing'
import { findTurnRow, MOUNT_FRAMES, pollFrames } from '../../../utils/mountTurn'
import { jumpTargets } from '../utils/jumpTargets'

const HIGHLIGHT_CLASS = 'jump-highlight'

/** Ignore sub-pixel and near-edge offsets when deciding what is above/below. */
const EDGE_EPSILON_PX = 10

/**
 * Provide jump navigation callbacks between human messages in chat.
 *
 * Targets are resolved from the virtualizer's measurements rather than mounted elements: with the
 * turn list windowed, a turn outside the viewport has no DOM, so a geometry sweep over
 * `[data-testid="message-user"]` would only see turns already on screen, stalling upward jumps at
 * the window edge. Measurements cover every turn, mounted or not.
 *
 * Each jump picks an autoscroll engagement transition based on where it lands: off-bottom jumps
 * raise user intent (autoscroll disengages so streamed content doesn't yank the view back);
 * at-bottom jumps mark a return to the bottom (autoscroll re-engages for the next streamed token).
 *
 * @param {object} messagesRef - Ref to the chat-messages scroll container.
 * @param {function} [markProgrammaticScroll] - Brackets scroll writes so they
 *   do not raise user-intent in the onScroll handler.
 * @param {function} [markUserIntent] - Fired before an off-bottom jump.
 * @param {function} [markReturnedToBottom] - Fired before an at-bottom jump.
 * @param {object} [virtualizerRef] - Ref holding the turn virtualizer.
 */
export default function useMessageJump(
  messagesRef,
  markProgrammaticScroll,
  markUserIntent,
  markReturnedToBottom,
  virtualizerRef,
) {
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

  /** Highlight a turn's user message, falling back to the turn itself. */
  const highlightTurn = useCallback(
    el => {
      const target = el?.querySelector('[data-testid="message-user"]') || el
      if (target) {
        highlightElement(target)
      }
    },
    [highlightElement],
  )

  /** Scroll a turn index to the top of the viewport and highlight it once mounted. */
  const goToIndex = useCallback(
    index => {
      const virtualizer = virtualizerRef?.current
      markUserIntent?.()
      markProgrammaticScroll?.()
      virtualizer.scrollToIndex(index, { align: 'start' })
      // The turn may be windowed out and only mount on a later frame, so highlighting on the next
      // frame alone would usually find nothing.
      pollFrames(MOUNT_FRAMES, () => findTurnRow(index), highlightTurn)
    },
    [virtualizerRef, markProgrammaticScroll, markUserIntent, highlightTurn],
  )

  /** Land on an already-mounted turn (the active one) and highlight it. */
  const goToElement = useCallback(
    (container, target, engage) => {
      engage()
      markProgrammaticScroll?.()
      container.scrollTop = target.start
      highlightTurn(target.el)
    },
    [markProgrammaticScroll, highlightTurn],
  )

  const jumpPrev = useCallback(() => {
    const container = messagesRef.current
    if (!container) {
      return
    }

    const cutoff = container.scrollTop - EDGE_EPSILON_PX
    const target = [...jumpTargets(container, virtualizerRef)].reverse().find(t => t.start < cutoff)
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
  }, [messagesRef, virtualizerRef, goToIndex, goToElement, markProgrammaticScroll, markUserIntent])

  const jumpNext = useCallback(() => {
    const container = messagesRef.current
    if (!container) {
      return
    }

    const cutoff = container.scrollTop + EDGE_EPSILON_PX
    const target = jumpTargets(container, virtualizerRef).find(t => t.start > cutoff)
    if (target?.el) {
      goToElement(container, target, () => markUserIntent?.())
      return
    }
    if (target) {
      goToIndex(target.index)
      return
    }

    // Past the last historical turn - the active turn lives at the bottom, so landing there re-engages autoscroll.
    markReturnedToBottom?.()
    markProgrammaticScroll?.()
    container.scrollTop = container.scrollHeight
  }, [
    messagesRef,
    virtualizerRef,
    goToIndex,
    goToElement,
    markProgrammaticScroll,
    markUserIntent,
    markReturnedToBottom,
  ])

  const jumpTop = useCallback(() => {
    const container = messagesRef.current
    if (!container) {
      return
    }
    markUserIntent?.()
    markProgrammaticScroll?.()
    container.scrollTop = 0
  }, [messagesRef, markProgrammaticScroll, markUserIntent])

  const jumpBottom = useCallback(() => {
    const container = messagesRef.current
    if (!container) {
      return
    }
    markReturnedToBottom?.()
    markProgrammaticScroll?.()
    container.scrollTop = container.scrollHeight
  }, [messagesRef, markProgrammaticScroll, markReturnedToBottom])

  return { jumpPrev, jumpNext, jumpTop, jumpBottom }
}
