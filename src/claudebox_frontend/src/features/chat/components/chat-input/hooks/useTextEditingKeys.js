/** Shared text-editing key handler: shortcuts common to the composer and inline reply boxes. */

import { useCallback } from 'react'
import { shiftEnter, tabKey, wrapInTags, wrapPair } from '../utils/textTransforms'

/**
 * Dispatches text-editing shortcuts shared by the composer and reply boxes: Tab/Shift+Tab,
 * Shift+Enter, Ctrl+. interrupt, Ctrl+comma wrap, block collapse/expand, and auto-pair wrap.
 * Excludes Enter-to-submit, Alt+Enter-queue, arrow-key history, and stash - those stay with the caller.
 *
 * @param {Object} params
 * @param {Function} params.getState - () => ({ value, selStart, selEnd }) - current textarea state.
 * @param {Function} params.applyResult - ({ value, selStart?, selEnd? }) => void; omitted
 *   selStart/selEnd leaves selection unmanaged.
 * @param {import('../BlockCollapseManager').default} params.collapseManager
 * @param {Function} [params.onInterrupt] - Ctrl+. handler.
 * @param {boolean} [params.canInterrupt=true] - Whether Ctrl+. is currently allowed.
 * @returns {{ handleKeyDown: (e: KeyboardEvent) => boolean }} True when the caller should stop
 *   processing the key further.
 */
export default function useTextEditingKeys({
  getState,
  applyResult,
  collapseManager,
  onInterrupt,
  canInterrupt = true,
}) {
  const handleKeyDown = useCallback(
    e => {
      if (e.key === 'Tab') {
        e.preventDefault()
        const { value, selStart, selEnd } = getState()
        const result = tabKey(value, selStart, selEnd, e.shiftKey)
        if (result) {
          applyResult(result)
        }
        return true
      }

      // Shift+Enter - smart newline. Plain Enter (submit) and Alt+Enter (queue) stay with the caller.
      if (e.key === 'Enter' && e.shiftKey && !e.altKey) {
        e.preventDefault()
        const { value, selStart } = getState()
        applyResult(shiftEnter(value, selStart))
        return true
      }

      if (e.key === '.' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (canInterrupt) {
          onInterrupt?.()
        }
        return true
      }

      if (e.key === ',' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        const { value, selStart, selEnd } = getState()
        applyResult(wrapInTags(value, selStart, selEnd))
        return true
      }

      // Ctrl+' collapse local, Ctrl+" (Ctrl+Shift+') collapse all.
      if ((e.key === "'" || e.key === '"') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        const { value, selStart } = getState()
        if (e.key === '"') {
          const result = collapseManager.collapseAll(value)
          applyResult({ value: result.value })
        } else {
          const result = collapseManager.collapseLocal(value, selStart)
          if (result) {
            applyResult({ value: result.value, selStart: result.cursor, selEnd: result.cursor })
          }
        }
        return true
      }

      // Ctrl+\ expand local, Ctrl+| (Ctrl+Shift+\) expand all.
      if ((e.key === '\\' || e.key === '|') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        const { value, selStart } = getState()
        if (e.key === '|') {
          const result = collapseManager.expandAll(value)
          applyResult({ value: result.value })
        } else {
          const result = collapseManager.expandLocal(value, selStart)
          if (result) {
            applyResult({ value: result.value, selStart: result.cursor, selEnd: result.cursor })
          }
        }
        return true
      }

      // Wraps paired characters (quotes, brackets); must run last since it consumes pairable printable keys.
      const { value, selStart, selEnd } = getState()
      const paired = wrapPair(value, selStart, selEnd, e.key)
      if (paired) {
        e.preventDefault()
        applyResult(paired)
        return true
      }

      return false
    },
    [getState, applyResult, collapseManager, onInterrupt, canInterrupt],
  )

  return { handleKeyDown }
}
