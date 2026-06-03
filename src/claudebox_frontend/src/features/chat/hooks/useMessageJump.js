/** Jump navigation between human messages in the chat scroll container. */

import { useCallback, useRef } from 'react'
import { MESSAGE_JUMP_HIGHLIGHT_MS, MESSAGE_JUMP_SCROLL_MS } from '../../../config/timing'
import { scrollToEdge } from '../../../utils/scroll'

const HIGHLIGHT_CLASS = 'jump-highlight'

/**
 * Provide jump navigation callbacks between human messages in chat.
 *
 * @param {object} messagesRef - Ref to the chat-messages scroll container.
 * @param {function} [markProgrammaticScroll] - Optional callback invoked
 *   before each scroll write so the controller treats the scroll as
 *   programmatic (does not raise user-intent in the onScroll handler).
 */
export default function useMessageJump(messagesRef, markProgrammaticScroll) {
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
        markProgrammaticScroll?.()
        scrollToEdge(container, elements[i], 'top', MESSAGE_JUMP_SCROLL_MS)
        highlightElement(elements[i])
        return
      }
    }

    // No message above viewport
    markProgrammaticScroll?.()
    container.scrollTop = 0
  }, [messagesRef, getMessageElements, highlightElement, markProgrammaticScroll])

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

    // Find first message whose top is below viewport (with 10px margin)
    for (let i = 0; i < elements.length; i++) {
      const rect = elements[i].getBoundingClientRect()
      if (rect.top > containerBottom - 10) {
        scrollToEdge(container, elements[i], 'top', MESSAGE_JUMP_SCROLL_MS)
        highlightElement(elements[i])
        return
      }
    }

    // No message below viewport — scroll to bottom
    markProgrammaticScroll?.()
    container.scrollTop = container.scrollHeight
  }, [messagesRef, getMessageElements, highlightElement, markProgrammaticScroll])

  const jumpTop = useCallback(() => {
    const container = messagesRef.current
    if (!container) {
      return
    }
    markProgrammaticScroll?.()
    container.scrollTop = 0
  }, [messagesRef, markProgrammaticScroll])

  const jumpBottom = useCallback(() => {
    const container = messagesRef.current
    if (!container) {
      return
    }
    markProgrammaticScroll?.()
    container.scrollTop = container.scrollHeight
  }, [messagesRef, markProgrammaticScroll])

  return { jumpPrev, jumpNext, jumpTop, jumpBottom }
}
