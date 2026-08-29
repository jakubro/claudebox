/** Jump navigation between human messages in the chat scroll container. */

import { useCallback } from 'react'
import useColumnStep from './useColumnStep'

/**
 * Provide jump navigation callbacks between human messages in chat.
 *
 * Wraps `useColumnStep` with the transcript's row selector, highlight target and trailing-element
 * resolver, and adds `jumpTop`/`jumpBottom`, which the terminal column does not get.
 *
 * @param {object} messagesRef - Ref to the chat-messages scroll container.
 * @param {function} [markProgrammaticScroll] - Brackets scroll writes so they
 *   do not raise user-intent in the onScroll handler.
 * @param {function} [markUserIntent] - Fired before an off-bottom jump.
 * @param {function} [markReturnedToBottom] - Fired before an at-bottom jump.
 * @param {object} [virtualizerRef] - Ref holding the turn virtualizer.
 * @param {Element} [root] - Scopes the row lookup to one rail group; see useColumnStep.
 */
export default function useMessageJump(
  messagesRef,
  markProgrammaticScroll,
  markUserIntent,
  markReturnedToBottom,
  virtualizerRef,
  root,
) {
  const resolveHighlightTarget = useCallback(
    el => el?.querySelector('[data-testid="message-user"]') || el,
    [],
  )
  const resolveTrailingEl = useCallback(
    container => container.querySelector(':scope > [data-testid="turn-container"]'),
    [],
  )

  const { stepPrev: jumpPrev, stepNext: jumpNext } = useColumnStep({
    containerRef: messagesRef,
    virtualizerRef,
    markProgrammaticScroll,
    markUserIntent,
    markReturnedToBottom,
    rowSelector: '.historical-turn-row',
    resolveHighlightTarget,
    resolveTrailingEl,
    root,
  })

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
