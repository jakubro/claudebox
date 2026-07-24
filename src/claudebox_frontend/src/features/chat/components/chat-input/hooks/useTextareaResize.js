/** Auto-resize textarea to fit content with scroll compensation. */

import { useCallback, useEffect, useRef } from 'react'
import useComposerMaxHeight from './useComposerMaxHeight'

/** Manage textarea auto-resize with scroll compensation for chat input. */
export default function useTextareaResize(
  textareaRef,
  panelRef,
  messagesRef,
  isAutoScrollEnabledRef,
) {
  const maxTextareaHeight = useComposerMaxHeight(panelRef)
  const prevTextareaHeightRef = useRef(0)

  // Resize textarea to fit content with scroll compensation
  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current
    const chatEl = messagesRef.current
    if (!textarea) {
      return
    }

    const prevHeight = prevTextareaHeightRef.current
    textarea.style.height = 'auto'
    const newHeight = Math.min(textarea.scrollHeight, maxTextareaHeight)
    textarea.style.height = `${newHeight}px`

    // Enable internal scroll when at max height
    textarea.style.overflowY = newHeight >= maxTextareaHeight ? 'auto' : 'hidden'

    // Compensate chat scroll so content stays visible as textarea grows/shrinks
    if (chatEl && prevHeight !== newHeight) {
      if (isAutoScrollEnabledRef.current) {
        // Pin to bottom when autoscroll engaged (prevents disengage from viewport shrink)
        chatEl.scrollTop = chatEl.scrollHeight
      } else {
        // Preserve reading position when user scrolled up
        chatEl.scrollTop += newHeight - prevHeight
      }
    }
    prevTextareaHeightRef.current = newHeight
  }, [textareaRef, messagesRef, isAutoScrollEnabledRef, maxTextareaHeight])

  // Auto-resize textarea on input (uncontrolled - use event listener)
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }
    textarea.addEventListener('input', resizeTextarea)
    return () => textarea.removeEventListener('input', resizeTextarea)
  }, [textareaRef, resizeTextarea])

  // Re-apply resize when max height changes (panel resize)
  useEffect(() => {
    resizeTextarea()
  }, [resizeTextarea])

  return { resizeTextarea }
}
