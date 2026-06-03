/** Selection wrapping for paired characters (quotes, brackets). */

import { useCallback } from 'react'

const WRAP_PAIRS = {
  "'": "'",
  '"': '"',
  '`': '`',
  '(': ')',
  '[': ']',
  '{': '}',
}

/** Manage selection wrapping with paired characters. */
export default function useAutoPair(resizeTextarea) {
  /**
   * Wrap selected text with paired characters on keydown.
   * Returns true if wrapping occurred (caller should not process further).
   */
  const wrapSelection = useCallback(
    (textarea, event) => {
      const { selectionStart, selectionEnd } = textarea
      if (selectionStart === selectionEnd) {
        return false
      }

      const close = WRAP_PAIRS[event.key]
      if (!close) {
        return false
      }

      event.preventDefault()
      const before = textarea.value.slice(0, selectionStart)
      const selected = textarea.value.slice(selectionStart, selectionEnd)
      const after = textarea.value.slice(selectionEnd)
      textarea.value = before + event.key + selected + close + after

      // Position cursor after closing character
      const newPos = selectionEnd + 2 // +1 open +1 close, cursor after close
      textarea.selectionStart = textarea.selectionEnd = newPos

      resizeTextarea()
      return true
    },
    [resizeTextarea],
  )

  return { wrapSelection }
}
