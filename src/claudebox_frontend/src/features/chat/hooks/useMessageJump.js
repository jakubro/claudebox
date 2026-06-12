/** Jump navigation between human messages in the chat scroll container. */

import { useCallback, useRef } from 'react'
import { MESSAGE_JUMP_HIGHLIGHT_MS, MESSAGE_JUMP_SCROLL_MS } from '../../../config/timing'
import { scrollToEdge } from '../../../utils/scroll'

const HIGHLIGHT_CLASS = 'jump-highlight'

/**
 * Provide jump navigation callbacks between human messages in chat.
 *
 * Each jump picks an autoscroll engagement transition based on where it lands:
 * off-bottom jumps raise user intent (autoscroll disengages so streamed
 * content does not yank the view back); at-bottom jumps mark a return to the
 * bottom (autoscroll re-engages so the next streamed token keeps the view at
 * the bottom).
 *
 * @param {object} messagesRef - Ref to the chat-messages scroll container.
 * @param {function} [markProgrammaticScroll] - Optional callback invoked
 *   before each scroll write so the controller treats the scroll as
 *   programmatic (does not raise user-intent in the onScroll handler).
 * @param {function} [markUserIntent] - Optional callback fired before an
 *   off-bottom jump so autoscroll disengages.
 * @param {function} [markReturnedToBottom] - Optional callback fired before
 *   an at-bottom jump so autoscroll re-engages.
 */
export default function useMessageJump(
  messagesRef,
  markProgrammaticScroll,
  markUserIntent,
  markReturnedToBottom,
) {
  const highlightTimeoutRef = useRef(null)

  const getMessageElements = useCallback(() => {
    const container = messagesRef.current
    if (!container) {
      return []
    }
    return Array.from(container.querySelectorAll('[data-testid="message-user"]'))
  }, [messagesRef])

  const highlightElement = useCallback(el => {
    // Clear any pending highlight
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

  const jumpPrev = useCallback(() => {
    const container = messagesRef.current
    if (!container) {
      return
    }
    const elements = getMessageElements()
    if (elements.length === 0) {
      return
    }

    const containerRect = container.getBoundingClientRect()
    const containerTop = containerRect.top

    // Find last message whose top is above viewport (must be at least 10px above)
    for (let i = elements.length - 1; i >= 0; i--) {
      const rect = elements[i].getBoundingClientRect()
      if (rect.top < containerTop - 10) {
        markUserIntent?.()
        markProgrammaticScroll?.()
        scrollToEdge(container, elements[i], 'top', MESSAGE_JUMP_SCROLL_MS)
        highlightElement(elements[i])
        return
      }
    }

    // No message above viewport
    markUserIntent?.()
    markProgrammaticScroll?.()
    container.scrollTop = 0
  }, [messagesRef, getMessageElements, highlightElement, markProgrammaticScroll, markUserIntent])

  const jumpNext = useCallback(() => {
    const container = messagesRef.current
    if (!container) {
      return
    }
    const elements = getMessageElements()
    if (elements.length === 0) {
      return
    }

    const containerRect = container.getBoundingClientRect()
    const containerBottom = containerRect.bottom

    // Find first message whose top is below viewport (with 10px margin) - mid-list landing.
    for (let i = 0; i < elements.length; i++) {
      const rect = elements[i].getBoundingClientRect()
      if (rect.top > containerBottom - 10) {
        markUserIntent?.()
        markProgrammaticScroll?.()
        scrollToEdge(container, elements[i], 'top', MESSAGE_JUMP_SCROLL_MS)
        highlightElement(elements[i])
        return
      }
    }

    // No message below viewport - lands at bottom, re-engage autoscroll.
    markReturnedToBottom?.()
    markProgrammaticScroll?.()
    container.scrollTop = container.scrollHeight
  }, [
    messagesRef,
    getMessageElements,
    highlightElement,
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
