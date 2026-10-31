/** Keyboard shortcut dispatch and chat action handlers. */

import { useCallback, useEffect, useRef, useState } from 'react'
import useInterruptHandler from '../../../../../hooks/useInterruptHandler'
import { applyUndoableEdit } from '../utils/undoableEdit'
import useTextEditingKeys from './useTextEditingKeys'

/**
 * @param {object} params.textareaRef - Ref to the textarea element.
 * @param {Function} params.peekInput - Reads textarea content without clearing it; null means empty.
 * @param {Function} params.submitBlock - Why a submit cannot go now ('loading', 'sending'), or null.
 * @param {Function} params.commitInput - Takes a sent input out of the box; text typed since stays.
 * @param {Function} params.extractInput - Extracts and clears textarea content (used by the queue).
 * @param {Function} params.send - Send-message callback.
 * @param {Function} params.setSending - Toggles the sending state.
 * @param {Function|null} params.enqueueMessage - Queues a message for later sending; null when none.
 * @param {Function} params.deferSend - Defers a message to auto-send once session creation completes.
 * @param {object} [params.pendingFormRef] - Ref to the active turn's live AskUserQuestion form, if any.
 * @param {boolean} params.isCreating - Whether the session is being created (routes submit to defer/queue).
 * @param {boolean} params.canInterrupt - Whether interrupt is allowed.
 * @param {string} params.interruptStatus - Current interrupt status.
 * @param {Function} params.startInterrupt - Starts the interrupt flow.
 * @param {Function} params.completeInterrupt - Completes the interrupt flow.
 * @param {Function} params.setError - Error setter.
 * @param {Function} params.stashPush - Pushes to the stash.
 * @param {Function} params.stashPop - Pops from the stash.
 * @param {Function} params.clearPendingInsert - Clears the pending stash insert.
 * @param {Function} params.saveDrafts - Saves drafts.
 * @param {Function} params.navigateUp - Navigates history up.
 * @param {Function} params.navigateDown - Navigates history down.
 * @param {import('../BlockCollapseManager').default} params.collapseManager - Block collapse/expand state.
 * @param {boolean} params.isMobile - Whether in a mobile viewport (skips Enter-to-submit).
 * @returns {{ handleKeyDown, handleSubmit, handleInterrupt, handleQueue, submitOrAnswer }}
 */
export default function useChatKeyboard({
  textareaRef,
  peekInput,
  submitBlock,
  commitInput,
  extractInput,
  send,
  setSending,
  enqueueMessage,
  deferSend,
  hasBufferedReplies,
  pendingFormRef,
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
  navigateUp,
  navigateDown,
  collapseManager,
  isMobile = false,
}) {
  const inFlightRef = useRef(null)
  const submitWantedRef = useRef(false)
  const [followUpCount, setFollowUpCount] = useState(0)

  // Peek, send, and commit only on success - text is preserved on failure.
  // During session creation, the first message defers; later ones route to the queue.
  const handleSubmit = useCallback(async () => {
    const block = submitBlock()
    if (block === 'sending') {
      if ((textareaRef.current?.value ?? '') !== inFlightRef.current) {
        submitWantedRef.current = true
      }
      return
    }
    if (block) {
      return
    }
    const input = peekInput()
    // Composer is empty, but a reply-only inline batch still sends (no side bar).
    if (!(input || hasBufferedReplies?.())) {
      return
    }

    if (input && isCreating) {
      commitInput(input)
      deferSend(input.rawPrompt, input.currentAttachments)
      return
    }

    const rawPrompt = input?.rawPrompt ?? ''
    inFlightRef.current = rawPrompt
    setSending(true)
    let sent = false
    try {
      sent = await send(rawPrompt, { attachments: input?.currentAttachments ?? [] })
      if (sent && input) {
        commitInput(input)
      }
    } finally {
      inFlightRef.current = null
      setSending(false)
      const wanted = submitWantedRef.current
      submitWantedRef.current = false
      if (wanted && sent) {
        setFollowUpCount(count => count + 1)
      }
    }
  }, [
    textareaRef,
    submitBlock,
    peekInput,
    commitInput,
    send,
    setSending,
    isCreating,
    deferSend,
    hasBufferedReplies,
  ])

  // After the commit renders: called at once, it would peek this closure's stale attachments.
  const latestSubmitRef = useRef(handleSubmit)
  latestSubmitRef.current = handleSubmit
  useEffect(() => {
    if (followUpCount > 0) {
      void latestSubmitRef.current()
    }
  }, [followUpCount])

  // Enter's action, shared with a reply box: a pending form with a choice made takes priority over
  // the composer's empty-check, so the note rides with the answer instead of skipping the question.
  const submitOrAnswer = useCallback(() => {
    if (pendingFormRef?.current?.hasSelection()) {
      pendingFormRef.current.submit()
      return
    }
    void handleSubmit()
  }, [pendingFormRef, handleSubmit])

  // Alt+Enter queues message for later sending; with no queue (the welcome screen) the text stays.
  const handleQueue = useCallback(() => {
    if (!enqueueMessage) {
      return
    }
    const input = extractInput()
    if (!input) {
      return
    }
    enqueueMessage(input.rawPrompt, input.currentAttachments)
  }, [extractInput, enqueueMessage])

  const handleInterrupt = useInterruptHandler({
    startInterrupt,
    completeInterrupt,
    setError,
    disabled: !canInterrupt || interruptStatus === 'stopping',
  })

  const handleStash = useCallback(() => {
    const textarea = textareaRef.current
    const value = textarea?.value
    if (value?.trim() && textarea) {
      clearPendingInsert()
      stashPush(value)
      textarea.value = ''
      // saveDrafts also clears the stack - the input dispatch below only updates `current`.
      saveDrafts({ current: '', stack: [] })
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }, [textareaRef, stashPush, clearPendingInsert, saveDrafts])

  const handleStashPop = useCallback(() => {
    stashPop()
  }, [stashPop])

  const getEditingState = useCallback(() => {
    const ta = textareaRef.current
    return {
      value: ta?.value ?? '',
      selStart: ta?.selectionStart ?? 0,
      selEnd: ta?.selectionEnd ?? 0,
    }
  }, [textareaRef])

  // The edit fires the input event typing produces, so drafts/autocomplete/resize observers see it.
  const applyEditingResult = useCallback(
    result => applyUndoableEdit(textareaRef.current, result),
    [textareaRef],
  )

  const { handleKeyDown: handleSharedKeyDown } = useTextEditingKeys({
    getState: getEditingState,
    applyResult: applyEditingResult,
    collapseManager,
    onInterrupt: handleInterrupt,
  })

  const handleKeyDown = useCallback(
    e => {
      // Alt+Enter to queue message
      if (e.key === 'Enter' && e.altKey && !e.shiftKey) {
        e.preventDefault()
        handleQueue()
        return
      }

      // Enter submits (desktop only - mobile uses the send button).
      if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
        e.preventDefault()
        submitOrAnswer()
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

      // Tab/Shift+Tab, Shift+Enter, Ctrl+., Ctrl+comma, collapse/expand, auto-pair - shared with inline replies.
      handleSharedKeyDown(e)
    },
    [
      handleQueue,
      submitOrAnswer,
      navigateUp,
      navigateDown,
      handleStash,
      handleStashPop,
      handleSharedKeyDown,
      isMobile,
    ],
  )

  return { handleKeyDown, handleSubmit, handleInterrupt, handleQueue, submitOrAnswer }
}
