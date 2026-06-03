/** Keyboard shortcut dispatch and chat action handlers. */

import { useCallback } from 'react'
import useInterruptHandler from '../../../../../hooks/useInterruptHandler'
import { applyShiftEnter } from '../utils/smartNewline'
import { applyTabKey } from '../utils/textareaIndent'

/**
 * Hook for keyboard shortcut dispatch and chat action handlers.
 * @param {Object} params
 * @param {Object} params.textareaRef - Ref to textarea element
 * @param {Function} params.peekInput - Read textarea content without clearing
 * @param {Function} params.commitInput - Clear textarea after successful send
 * @param {Function} params.extractInput - Extracts and clears textarea content (used by queue)
 * @param {Function} params.send - Send message callback
 * @param {Function} params.setSending - Toggle sending state
 * @param {Function} params.enqueueMessage - Queue a message for later sending
 * @param {Function} params.deferSend - Defer a message for auto-send when session creation completes.
 * @param {boolean} params.isCreating - Whether session is being created (routes submit to defer/queue).
 * @param {boolean} params.canInterrupt - Whether interrupt is allowed
 * @param {string} params.interruptStatus - Current interrupt status
 * @param {Function} params.startInterrupt - Start interrupt flow
 * @param {Function} params.completeInterrupt - Complete interrupt flow
 * @param {Function} params.setError - Error setter
 * @param {Function} params.stashPush - Push to stash
 * @param {Function} params.stashPop - Pop from stash
 * @param {Function} params.clearPendingInsert - Clear pending stash insert
 * @param {Function} params.saveDrafts - Save drafts
 * @param {Function} params.resizeTextarea - Resize textarea
 * @param {Function} params.navigateUp - Navigate history up
 * @param {Function} params.navigateDown - Navigate history down
 * @param {Function} params.collapseLocal - Collapse local block
 * @param {Function} params.collapseAll - Collapse all blocks
 * @param {Function} params.expandLocal - Expand local block
 * @param {Function} params.expandAll - Expand all blocks
 * @param {Function} params.wrapSelection - Auto-pair wrap selection
 * @param {boolean} params.isMobile - Whether in mobile viewport (skips Enter-to-submit).
 * @returns {{ handleKeyDown, handleSubmit, handleInterrupt, handleQueue }}
 */
export default function useChatKeyboard({
  textareaRef,
  peekInput,
  commitInput,
  extractInput,
  send,
  setSending,
  enqueueMessage,
  deferSend,
  isCreating,
  canInterrupt,
  interruptStatus,
  startInterrupt,
  completeInterrupt,
  setError,
  stashPush,
  stashPop,
  clearPendingInsert,
  saveDrafts,
  resizeTextarea,
  navigateUp,
  navigateDown,
  collapseLocal,
  collapseAll,
  expandLocal,
  expandAll,
  wrapSelection,
  isMobile = false,
}) {
  // Submit handler — peek input, send, commit only on success to preserve text on failure
  // During session creation, first message defers (auto-sends when ready);
  // subsequent messages during creation route to the queue.
  const handleSubmit = useCallback(async () => {
    const input = peekInput()
    if (!input) {
      return
    }

    if (isCreating) {
      commitInput(input.rawPrompt)
      deferSend(input.rawPrompt, input.currentAttachments)
      return
    }

    setSending(true)
    try {
      await send(input.rawPrompt, input.currentAttachments)
      commitInput(input.rawPrompt)
    } catch {
      // Text remains in textarea — nothing to restore
    } finally {
      setSending(false)
    }
  }, [peekInput, commitInput, send, setSending, isCreating, deferSend])

  // Queue handler — Alt+Enter queues message for later sending
  const handleQueue = useCallback(() => {
    const input = extractInput()
    if (!input) {
      return
    }
    enqueueMessage(input.rawPrompt, input.currentAttachments)
  }, [extractInput, enqueueMessage])

  // Interrupt handler
  const handleInterrupt = useInterruptHandler({
    startInterrupt,
    completeInterrupt,
    setError,
    disabled: !canInterrupt || interruptStatus === 'stopping',
  })

  // Stash current input
  const handleStash = useCallback(() => {
    const textarea = textareaRef.current
    const value = textarea?.value
    if (value?.trim() && textarea) {
      clearPendingInsert()
      stashPush(value)
      textarea.value = ''
      saveDrafts({ current: '', stack: [] })
      resizeTextarea()
    }
  }, [textareaRef, stashPush, clearPendingInsert, saveDrafts, resizeTextarea])

  // Pop from stash
  const handleStashPop = useCallback(() => {
    stashPop()
  }, [stashPop])

  // Wrap selection in <this></this> tags
  const handleWrapInTags = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const value = textarea.value
    const hasSelection = start !== end
    const selection = value.slice(start, end)

    const before = value.slice(0, start)
    const after = value.slice(end)
    const wrapped = `<this>${selection}</this>`

    textarea.value = before + wrapped + after
    const newPos = hasSelection ? start + wrapped.length : start + 6
    textarea.selectionStart = textarea.selectionEnd = newPos
    resizeTextarea()
  }, [textareaRef, resizeTextarea])

  // Key handler - includes all textarea-focused shortcuts
  const handleKeyDown = useCallback(
    e => {
      // Tab — indent (Shift+Tab — dedent). Picker priority is enforced upstream by
      // ChatInput.jsx delegation; if the picker handled Tab, this code never runs.
      if (e.key === 'Tab') {
        e.preventDefault()
        const ta = textareaRef.current
        if (ta && applyTabKey(ta, e.shiftKey)) {
          ta.dispatchEvent(new Event('input', { bubbles: true }))
          resizeTextarea()
        }
        return
      }

      // Shift+Enter — smart newline. Layer 1: inherit current line's leading
      // whitespace on the new line. Layer 2 (list lines): continue the marker
      // (auto-incremented for numbered, always unchecked for tasks). Empty
      // marker exits the list. Plain Enter (submit) and Alt+Enter (queue)
      // fall through unchanged.
      if (e.key === 'Enter' && e.shiftKey && !e.altKey) {
        e.preventDefault()
        const ta = textareaRef.current
        if (ta) {
          applyShiftEnter(ta)
          ta.dispatchEvent(new Event('input', { bubbles: true }))
          resizeTextarea()
        }
        return
      }

      // Alt+Enter to queue message
      if (e.key === 'Enter' && e.altKey && !e.shiftKey) {
        e.preventDefault()
        handleQueue()
        return
      }

      // Enter to submit (desktop only — mobile uses send button)
      if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
        e.preventDefault()
        void handleSubmit()
        return
      }

      // Arrow navigation for history (Alt+Arrow reserved for message jump)
      if (e.key === 'ArrowUp' && !e.altKey && navigateUp()) {
        e.preventDefault()
        return
      }

      if (e.key === 'ArrowDown' && !e.altKey && navigateDown()) {
        e.preventDefault()
        return
      }

      // Ctrl+. to interrupt
      if (e.key === '.' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        void handleInterrupt()
        return
      }

      // Ctrl+S to stash (without Shift)
      if (e.key === 's' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        handleStash()
        return
      }

      // Ctrl+Shift+S to pop from stash
      if (e.key === 'S' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault()
        handleStashPop()
        return
      }

      // Ctrl+, to wrap in <this></this> tags
      if (e.key === ',' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleWrapInTags()
        return
      }

      // Ctrl+' to collapse local, Ctrl+" (Ctrl+Shift+') to collapse all
      if ((e.key === "'" || e.key === '"') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (e.key === '"') {
          collapseAll(textareaRef.current)
        } else {
          collapseLocal(textareaRef.current)
        }
        return
      }

      // Ctrl+\ to expand local, Ctrl+| (Ctrl+Shift+\) to expand all
      if ((e.key === '\\' || e.key === '|') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (e.key === '|') {
          expandAll(textareaRef.current)
        } else {
          expandLocal(textareaRef.current)
        }
        return
      }

      // Wrap selection with paired characters (quotes, brackets)
      if (textareaRef.current && wrapSelection(textareaRef.current, e)) {
        return
      }
    },
    [
      handleQueue,
      handleSubmit,
      navigateUp,
      navigateDown,
      handleInterrupt,
      handleStash,
      handleStashPop,
      handleWrapInTags,
      collapseLocal,
      collapseAll,
      expandLocal,
      expandAll,
      wrapSelection,
      textareaRef,
      isMobile,
      resizeTextarea,
    ],
  )

  return { handleKeyDown, handleSubmit, handleInterrupt, handleQueue }
}
